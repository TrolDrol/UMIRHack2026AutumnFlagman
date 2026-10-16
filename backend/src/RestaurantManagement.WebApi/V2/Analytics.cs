using System.Numerics;
using System.Text.Json;
using System.Text.Json.Nodes;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Application.Stock;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Supplies.ValueObjects;

namespace RestaurantManagement.WebApi.V2;

public sealed partial class WarehouseService
{
    static List<Batch> Virtual(WarehouseSnapshot s) => s.Batches.Select(b => {
        var c = new Batch(b.Id, b.WarehouseId, b.DeliveryId, b.SourceItemId, b.IngredientId, b.IngredientName, b.InitialQuantity, b.ReceivedAt, b.ManufacturedAt, b.ShelfLifeHours, b.ExpirationDate, b.Unit);
        var used = b.InitialQuantity.Value - b.RemainingQuantity.Value; if (used > 0) c.Deduct(Quantity.From(used)); if (b.HeldQuantity > 0) c.Hold(b.HeldQuantity); return c;
    }).ToList();
    public object ComboPlan(WarehouseSnapshot s, ComboPlanInput input)
    {
        foreach (var id in input.CandidateDishIds) if (!s.Dish(id).Active) throw ApiFailure.Conflict("DISH_INACTIVE");
        var risk = s.Ingredients.ToDictionary(i => i.Id.Value, i => s.Batches.Where(b => b.IngredientId == i.Id && b.IsExpiringSoon(s.Now)).Sum(b => StockKernel.Available(b, s.Now)));
        var virtualStock = Virtual(s); var ids = input.CandidateDishIds.OrderBy(i => i.ToString(), StringComparer.Ordinal).ToArray();
        var pairs = ids.SelectMany((a, index) => ids.Skip(index + 1).Select(b => new Pair(a, b))).ToArray();
        foreach (var pair in pairs) {
            var lo = 0; var hi = 1000;
            while (lo < hi) { var mid = (lo + hi + 1) / 2; if (StockKernel.Plan(s.Ingredients, s.Dishes, s.Batches, [new(pair.A, mid), new(pair.B, mid)], s.Now).CanCreate) lo = mid; else hi = mid - 1; }
            pair.IndividualMax = lo;
        }
        if (risk.Values.Any(v => v > 0)) for (var n = 0; n < 60; n++) {
            s.Cancellation.ThrowIfCancellationRequested();
            var count = pairs.Count(p => p.Count > 0);
            var candidates = pairs.Where(p => p.Count < 20 && (count < 3 || p.Count > 0)).Select(p => {
                var plan = StockKernel.Plan(s.Ingredients, s.Dishes, virtualStock, [new(p.A, 1), new(p.B, 1)], s.Now, includeRisk: true);
                var score = 0d; var earliest = DateTime.MaxValue;
                foreach (var a in plan.Allocations.Where(a => a.RiskSnapshot!.Phase == "expiring" && risk[a.IngredientId] > 0)) {
                    score += (double)(a.Quantity.Value / risk[a.IngredientId]) * (2 - (a.ExpiresAt - s.Now).TotalSeconds / (a.RiskSnapshot!.ShelfLifeHours * 360));
                    if (a.ExpiresAt < earliest) earliest = a.ExpiresAt;
                }
                return (p, plan, score, earliest);
            }).Where(c => c.plan.CanCreate && c.score > 0).OrderByDescending(c => c.score).ThenBy(c => c.earliest).ThenBy(c => c.p.A + ":" + c.p.B, StringComparer.Ordinal).ToArray();
            if (candidates.Length == 0) break;
            var best = candidates[0]; best.p.Count++;
            foreach (var a in best.plan.Allocations) virtualStock.First(b => b.Id.Value == a.BatchId).Deduct(Quantity.From(a.Quantity.Value));
        }
        var selected = pairs.Where(p => p.Count > 0).ToArray();
        var lines = selected.SelectMany(p => new[] { new OrderLine(p.A, p.Count), new(p.B, p.Count) }).GroupBy(l => l.DishId).Select(g => new OrderLine(g.Key, g.Sum(l => l.Portions))).ToArray();
        var allocations = lines.Length == 0 ? [] : StockKernel.Plan(s.Ingredients, s.Dishes, s.Batches, lines, s.Now, includeRisk: true).Allocations;
        return new { asOf = s.Now, stateRevision = s.Warehouse.StateRevision, method = "joint_fefo_greedy_v1",
            proposals = selected.Select(p => new { titleSuggestion = s.Dish(p.A).Name + " + " + s.Dish(p.B).Name, components = new[] { new Component(p.A, 1), new(p.B, 1) }, suggestedUnits = p.Count,
                explanation = "Совместный подбор по фактическому FEFO расходу истекающих партий. Это рекомендация, а не резерв.", individualMaxUnits = p.IndividualMax }),
            allocations = allocations.Select(a => new { a.BatchId, a.IngredientId, unit = s.Batch(a.BatchId).Unit.Value, a.Quantity, expiringQuantity = a.RiskSnapshot!.Phase == "expiring" ? a.Quantity : new Amount(0) }),
            emptyReason = selected.Length > 0 ? null : risk.Values.Any(v => v > 0) ? "no_feasible_pairs" : "no_risk_stock", isReservation = false };
    }
    sealed class Pair(Guid a, Guid b) { public Guid A = a, B = b; public int Count, IndividualMax; }
    sealed class Demand
    {
        public required Dish Dish; public DateTime From; public long Exposure; public long Portions; public int OrderCount;
        public bool Enough; public bool Stopped; public DateTime? FirstStop; public long K = 1; public DateTime Next = DateTime.MaxValue;
        public object[] Limiting = [];
    }
    static DateTime NextSale(DateTime now, Demand d) => now.AddMilliseconds((long)(((BigInteger)d.K * d.Exposure + d.Portions - 1) / d.Portions));
    public object Forecast(WarehouseSnapshot s, IQueryCollection q)
    {
        QueryKeys(q, "historyDays", "horizonHours"); var days = Integer(q, "historyDays", 14, 7, 28); var hours = Integer(q, "horizonHours", 24, 6, 48);
        if (!new[] { 7, 14, 28 }.Contains(days)) throw ApiFailure.Invalid("historyDays"); if (!new[] { 6, 12, 24, 48 }.Contains(hours)) throw ApiFailure.Invalid("horizonHours");
        var end = s.Now.AddHours(hours); var from = s.Now.AddDays(-days); if (from < s.Warehouse.TrackingStartedAt) from = s.Warehouse.TrackingStartedAt;
        var orders = s.Orders.Where(o => o.CreatedAt >= from && o.CreatedAt < s.Now).ToArray(); var globalEnough = (s.Now - from).TotalDays >= 1 && orders.Length >= 10;
        var bs = Virtual(s); var consumed = new HashSet<Guid>(); var expired = new HashSet<Guid>();
        var data = s.Dishes.Where(d => d.Active).OrderBy(d => d.Id.Value.ToString(), StringComparer.Ordinal).Select(d => {
            var ownFrom = d.CreatedAt ?? s.Warehouse.TrackingStartedAt; if (ownFrom < from) ownFrom = from;
            var own = orders.Where(o => o.CreatedAt >= ownFrom && o.Items.Any(l => l.DishId == d.Id)).ToArray();
            var demand = new Demand { Dish = d, From = ownFrom, Exposure = (long)(s.Now - ownFrom).TotalMilliseconds, Portions = own.Sum(o => o.Items.Where(l => l.DishId == d.Id).Sum(l => (long)l.Quantity)), OrderCount = own.Length };
            demand.Enough = globalEnough && demand.Exposure >= 86400000 && demand.Portions > 0;
            demand.Stopped = StockKernel.MaxPortions(d, bs, s.Now) == 0; if (demand.Stopped) demand.FirstStop = s.Now;
            if (demand.Enough) demand.Next = NextSale(s.Now, demand); return demand;
        }).ToArray();
        void Capture(Demand d, DateTime at, bool current) {
            d.Limiting = StockKernel.Plan(s.Ingredients, s.Dishes, bs, [new(d.Dish.Id.Value, 1)], at).Requirements.Where(r => r.MissingQuantity.Value > 0).Select(r => (object)new {
                r.IngredientId, r.IngredientName, r.Unit, cause = current ? "current_shortage" : consumed.Contains(r.IngredientId) && expired.Contains(r.IngredientId) ? "combined" : expired.Contains(r.IngredientId) ? "expiry" : "consumption" }).ToArray();
        }
        void Check(DateTime at) { foreach (var d in data.Where(d => !d.Stopped)) if (StockKernel.MaxPortions(d.Dish, bs, at) == 0) { d.Stopped = true; d.FirstStop = at; Capture(d, at, false); } }
        foreach (var d in data.Where(d => d.Stopped)) Capture(d, s.Now, true);
        var expiries = bs.Select(b => b.ExpirationDate.Value).Where(t => t > s.Now && t <= end).Distinct().Order().ToArray();
        var index = 0; var attempts = 0; var through = s.Now; var limited = false;
        if (globalEnough) while (true) {
            s.Cancellation.ThrowIfCancellationRequested();
            var saleTime = data.Where(d => d.Enough && !d.Stopped).Select(d => d.Next).DefaultIfEmpty(DateTime.MaxValue).Min();
            var expiryTime = index < expiries.Length ? expiries[index] : DateTime.MaxValue; var at = saleTime < expiryTime ? saleTime : expiryTime;
            if (at > end) { through = end; break; }
            var group = data.Where(d => d.Enough && !d.Stopped && d.Next == at).ToArray();
            if (attempts + group.Length > 50000) { limited = true; break; }
            if (expiryTime == at) { foreach (var b in bs.Where(b => b.ExpirationDate.Value == at && b.FreeQuantity > 0)) expired.Add(b.IngredientId.Value); index++; Check(at); }
            foreach (var d in group) {
                attempts++; if (d.Stopped) continue;
                var plan = StockKernel.Plan(s.Ingredients, s.Dishes, bs, [new(d.Dish.Id.Value, 1)], at);
                foreach (var a in plan.Allocations) { consumed.Add(a.IngredientId); bs.First(b => b.Id.Value == a.BatchId).Deduct(Quantity.From(a.Quantity.Value)); }
                Check(at); d.K++; d.Next = NextSale(s.Now, d);
            }
            through = at;
        }
        var result = data.Select(d => {
            var unknown = data.Any(other => other.Dish.Id != d.Dish.Id && !other.Enough && other.Dish.RecipeIngredients.Any(r => d.Dish.RecipeIngredients.Any(own => own.Requirement.IngredientId == r.Requirement.IngredientId)));
            var changed = d.Dish.UpdatedAt > d.From; var status = d.FirstStop == s.Now ? "already_stopped" : !d.Enough ? "insufficient_history" : d.FirstStop != null ? "predicted" : limited ? "calculation_limited" : "not_reached_within_horizon";
            var limitations = new List<string>(); if (!d.Enough) limitations.Add("insufficient_observation"); if (unknown) limitations.Add("unknown_competing_demand"); if (changed) limitations.Add("recipe_changed_in_window"); if (limited) limitations.Add("event_cap");
            object? window = null;
            if (status == "predicted") { var ticks = d.FirstStop!.Value.Ticks; var unit = TimeSpan.FromMinutes(15).Ticks; var start = new DateTime(ticks / unit * unit, DateTimeKind.Utc); var finish = new DateTime((ticks + unit - 1) / unit * unit, DateTimeKind.Utc); window = new { from = start < s.Now ? s.Now : start, to = finish > end ? end : finish }; }
            return new { dishId = d.Dish.Id.Value, dishName = d.Dish.Name, status, estimatedWindow = window, observedFrom = d.From, exposureHours = d.Exposure / 3600000d, observedPortions = d.Portions,
                portionsPerCalendarHour = d.Enough ? (double?)(d.Portions / (d.Exposure / 3600000d)) : null,
                confidence = status == "insufficient_history" ? "insufficient" : d.Exposure >= 7 * 86400000L && orders.Length >= 50 && d.OrderCount >= 5 && !unknown && !changed ? "medium" : "low",
                limitations, limitingIngredients = status is "already_stopped" or "predicted" ? d.Limiting : [] };
        }).ToArray();
        return new { asOf = s.Now, stateRevision = s.Warehouse.StateRevision, method = "mean_demand_fefo_events_v1", horizonEndsAt = end, calculatedThrough = through,
            history = new { from, to = s.Now, exposureHours = (s.Now - from).TotalHours, completedOrders = orders.Length, observedFullDays = (int)(s.Now - from).TotalDays }, datasetKind = s.Warehouse.DatasetKind,
            assumptions = new[] { "Средний спрос по календарным часам, включая часы без продаж.", "Одна порция на событие; атомарные корзины не моделируются.", "При совпадении времени сначала истечение, затем продажи по стабильному ID блюда.", "Текущие рецепты; будущие поставки и снятие карантина не учитываются.", "Окно 15 минут — разрешение отображения, а не доверительный интервал.", "Прошлый стоп-лист и продвижение комбо могут изменить спрос." }, items = result };
    }

    public object RiskReport(WarehouseSnapshot s, IQueryCollection q)
    {
        QueryKeys(q, "view", "cohortEntry", "from", "to", "ingredientId", "batchId", "page", "pageSize");
        var view = EnumQuery(q, "view", "period", "cohort") ?? "period"; var entry = EnumQuery(q, "cohortEntry", "dated", "unknown") ?? "dated";
        if (view == "period" && q.ContainsKey("cohortEntry")) throw ApiFailure.Invalid("cohortEntry");
        DateTime ParseDate(string key) { try { return ContractJson.Parse<DateTime>(JsonSerializer.Serialize(q[key].ToString())); } catch (JsonException) { throw ApiFailure.Invalid(key); } }
        var from = ParseDate("from"); var to = ParseDate("to");
        if (from >= to || to > s.Now || (to - from).TotalDays > 90) throw ApiFailure.Invalid("from");
        var iid = QueryId(q, "ingredientId"); var bid = QueryId(q, "batchId"); var page = Integer(q, "page", 1, 1, int.MaxValue); var size = Integer(q, "pageSize", 50, 1, 100);
        var rows = new List<JsonObject>(); var unknownCount = 0;
        foreach (var b in s.Batches.Where(b => (iid == null || b.IngredientId.Value == iid) && (bid == null || b.Id.Value == bid))) {
            s.Cancellation.ThrowIfCancellationRequested();
            var own = s.Documents.Where(d => d.Kind == "movement" && d.BatchId == b.Id.Value).OrderBy(d => d.CreatedAt).ThenBy(d => d.EventSequence).Select(d => JsonNode.Parse(d.Json)!.AsObject()).ToArray();
            var threshold = StockKernel.Risk(b, s.Now).RiskStartsAt;
            var opening = s.Documents.FirstOrDefault(d => d.Kind == "opening_balance" && d.BatchId == b.Id.Value);
            var openingJ = opening == null ? null : JsonNode.Parse(opening.Json)!.AsObject();
            DateTime? cohortAt = b.ReceiptCommittedAt is { } receipt ? (receipt > threshold ? receipt : threshold) : opening != null && Qty(openingJ!, "physicalQuantity") > 0 && opening.CreatedAt <= threshold ? threshold : null;
            if (cohortAt == null && threshold <= s.Now) unknownCount++;
            var periodFlows = own.Where(m => Time(m, "createdAt") >= from && Time(m, "createdAt") < to && m["type"]!.GetValue<string>() is "order" or "write_off").ToArray();
            if (view == "period" && periodFlows.Length == 0 && !(b.RemainingQuantity.Value > 0 && threshold <= s.Now)) continue;
            if (view == "cohort" && (entry == "unknown" ? cohortAt != null || threshold > s.Now : cohortAt == null || cohortAt < from || cohortAt >= to)) continue;
            decimal? baseline = null; long sequence = -1;
            if (view == "cohort" && cohortAt != null) {
                if (opening != null && opening.CreatedAt <= cohortAt) { baseline = Qty(openingJ!, "physicalQuantity"); sequence = openingJ!["eventSequence"]!.GetValue<long>(); }
                else if (b.ReceiptCommittedAt >= s.Warehouse.TrackingStartedAt) {
                    var receiptEvent = own.FirstOrDefault(m => m["type"]!.GetValue<string>() == "receipt" && Time(m, "createdAt") == b.ReceiptCommittedAt);
                    if (receiptEvent != null) { baseline = Qty(receiptEvent, "remainingAfter"); sequence = receiptEvent["eventSequence"]!.GetValue<long>(); }
                }
                if (baseline != null) baseline += own.Where(m => m["eventSequence"]!.GetValue<long>() > sequence && Time(m, "createdAt") < cohortAt).Sum(m => Qty(m, "quantityDelta"));
                if (baseline == 0) continue;
            }
            var flows = view == "period" ? periodFlows : own.Where(m => m["type"]!.GetValue<string>() is "order" or "write_off" && Time(m, "createdAt") >= (cohortAt ?? s.Warehouse.TrackingStartedAt) && Time(m, "createdAt") <= s.Now && (baseline == null || m["eventSequence"]!.GetValue<long>() > sequence)).ToArray();
            decimal expiring = 0, fresh = 0, unknown = 0, expiredQ = 0, damaged = 0, used = 0, written = 0;
            foreach (var m in flows) {
                var amount = -Qty(m, "quantityDelta");
                if (m["type"]!.GetValue<string>() == "order") { used += amount; if (m["riskSnapshot"] == null) unknown += amount; else if (m["riskSnapshot"]!["phase"]!.GetValue<string>() == "expiring") expiring += amount; else fresh += amount; }
                else { written += amount; var wo = s.Documents.FirstOrDefault(d => d.Kind == "write_off" && d.Id == Id(m, "referenceId")); if (wo != null) { var reason = JsonNode.Parse(wo.Json)!["reason"]!.GetValue<string>(); if (reason == "expired") expiredQ += amount; else if (reason == "damaged") damaged += amount; } }
            }
            var balanced = baseline != null && baseline == used + written + b.RemainingQuantity.Value;
            var complete = view == "cohort" ? balanced : flows.All(m => m["riskSnapshot"] != null) && from >= s.Warehouse.TrackingStartedAt;
            var limitations = new List<string>(); if (!complete) limitations.Add("Неполная история: показаны только доказанные движения и текущий остаток."); if (view == "cohort" && cohortAt == null) limitations.Add("Дата входа неизвестна; потоки показаны с начала надёжного журнала.");
            rows.Add(Json(new { batchId = b.Id.Value, ingredientId = b.IngredientId.Value, ingredientName = s.Ingredient(b.IngredientId.Value).Name, unit = b.Unit.Value, deliveryId = b.DeliveryId.Value,
                deliveryNumber = s.Deliveries.First(d => d.Id == b.DeliveryId).Number, completeness = complete ? "complete" : "partial", limitations,
                usedExpiringQuantity = new Amount(expiring), usedFreshQuantity = new Amount(fresh), unknownRiskOrderQuantity = new Amount(unknown), writtenOffExpiredQuantity = new Amount(expiredQ), writtenOffDamagedQuantity = new Amount(damaged),
                remainingPhysicalAsOf = new Amount(b.RemainingQuantity.Value), heldAsOf = new Amount(b.HeldQuantity), expiredAsOf = new Amount(b.IsExpired(s.Now) ? b.RemainingQuantity.Value : 0),
                cohortAt = view == "cohort" ? cohortAt : null, riskAtEntry = balanced ? (Amount?)new Amount(baseline!.Value) : null,
                usedInOrdersAfterEntry = view == "cohort" && cohortAt != null ? (Amount?)new Amount(used) : null,
                writtenOffAfterEntry = view == "cohort" && cohortAt != null ? (Amount?)new Amount(written) : null, usedFraction = balanced && baseline > 0 ? (double?)((double)(used * 1000m) / (double)(baseline.Value * 1000m)) : null }));
        }
        var ordered = NameSort(rows, "ingredientName", "batchId").ToArray();
        var totals = ordered.GroupBy(j => (id: Id(j, "ingredientId"), unit: j["unit"]!.GetValue<string>())).Select(g => new {
            ingredientId = g.Key.id, ingredientName = g.First()["ingredientName"]!.GetValue<string>(), unit = g.Key.unit,
            usedExpiringQuantity = new Amount(g.Sum(j => Qty(j, "usedExpiringQuantity"))), usedFreshQuantity = new Amount(g.Sum(j => Qty(j, "usedFreshQuantity"))), unknownRiskOrderQuantity = new Amount(g.Sum(j => Qty(j, "unknownRiskOrderQuantity"))),
            writtenOffExpiredQuantity = new Amount(g.Sum(j => Qty(j, "writtenOffExpiredQuantity"))), writtenOffDamagedQuantity = new Amount(g.Sum(j => Qty(j, "writtenOffDamagedQuantity"))),
            knownCohortEntryQuantity = new Amount(g.Where(j => j["riskAtEntry"] != null).Sum(j => Qty(j, "riskAtEntry"))), unknownCohortCount = view == "cohort" ? g.Count(j => j["riskAtEntry"] == null) : 0 }).ToArray();
        return new { view, from, to, asOf = s.Now, cohortEntry = view == "cohort" ? entry : null, unknownEntryBatchCount = unknownCount,
            trackingStartedAt = s.Warehouse.TrackingStartedAt, policyVersion = "expiry-10pct-v1", completeness = ordered.All(j => j["completeness"]!.GetValue<string>() == "complete") ? "complete" : "partial",
            page, pageSize = size, total = ordered.Length, items = ordered.Skip((int)Math.Min(int.MaxValue, (long)(page - 1) * size)).Take(size), totalsByIngredient = totals };
    }
}
