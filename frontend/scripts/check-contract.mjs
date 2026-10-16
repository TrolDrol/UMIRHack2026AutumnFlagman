import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Versioned DTO baselines belong to the project, independent of planning documents.
const notation = fs.readFileSync("contracts/core-v2.ts.txt", "utf8");
const printer = ts.createPrinter({ removeComments: true });
function typeMap(source) {
  const file = ts.createSourceFile(
    "types.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  return Object.fromEntries(
    file.statements.filter(ts.isTypeAliasDeclaration).map((node) => {
      const withoutExport = ts.factory.updateTypeAliasDeclaration(
        node,
        undefined,
        node.name,
        node.typeParameters,
        node.type,
      );
      return [
        node.name.text,
        printer
          .printNode(ts.EmitHint.Unspecified, withoutExport, file)
          .replace(/\s+/g, ""),
      ];
    }),
  );
}
const expected = typeMap(notation),
  actual = typeMap(fs.readFileSync("src/shared/api/types.ts", "utf8"));
const extensions = typeMap(fs.readFileSync("contracts/extensions-v2.1.ts.txt", "utf8"));
const sharedExtensions = typeMap(
  fs.readFileSync("../packages/demo-api/src/shared/api/extensions.ts", "utf8"),
);
if (JSON.stringify(extensions) !== JSON.stringify(sharedExtensions))
  throw new Error("Общие новые DTO отличаются от контракта 2.1.0");
const common = typeMap(
  fs.readFileSync("../packages/demo-api/src/shared/api/types.ts", "utf8"),
);
if (JSON.stringify(common) !== JSON.stringify(actual))
  throw new Error("Базовые DTO рабочего места и mock API различаются");
const overlays = {
  Config: 'contractVersion: "2.1.0";',
  Batch:
    "heldQuantity: Quantity; availableQuantity: Quantity; heldExpiredQuantity: Quantity; version: number; receiptCommittedAt: Timestamp | null;",
  InventoryRow: "heldQuantity: Quantity; heldExpiredQuantity: Quantity;",
  Allocation: "riskSnapshot: RiskSnapshot | null;",
  Order:
    'source: "staff" | "waiter" | "integration" | "customer"; customerId?: string | null; composition: CompositionSnapshot[]; recipeSnapshot?: {dishId: UUID; recipe: RecipeLine[]}[];',
  Movement:
    'type: "receipt" | "order" | "write_off" | "quarantine_open" | "quarantine_release"; heldQuantityDelta: string; heldAfter: Quantity; quarantineId: UUID | null; actorUserId: UUID | null; integrationClientId: UUID | null; eventSequence: number; riskSnapshot: RiskSnapshot | null;',
};
function propertyMap(source, name) {
  const file = ts.createSourceFile(
    "dto.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const type = file.statements.find(
    (n) => ts.isTypeAliasDeclaration(n) && (!name || n.name.text === name),
  )?.type;
  if (!type || !ts.isTypeLiteralNode(type))
    throw new Error("Ожидается DTO object");
  return Object.fromEntries(
    type.members.map((p) => [
      p.name?.getText(file),
      printer.printNode(ts.EmitHint.Unspecified, p, file).replace(/\s+/g, ""),
    ]),
  );
}
for (const [name, baseline] of Object.entries(expected)) {
  if (name === "OrderInput") {
    if (actual[name] !== "typeOrderInput=OrderInput21;")
      throw new Error("OrderInput должен использовать общий DTO 2.1");
  } else if (name === "OrderReceipt") {
    if (
      actual[name] !==
      'typeOrderReceipt=Pick<Order,"id"|"number"|"createdAt"|"status"|"lines"|"composition">;'
    )
      throw new Error("Safe receipt must include composition");
  } else if (overlays[name]) {
    const wanted = {
      ...propertyMap(notation, name),
      ...propertyMap(`type Overlay = {${overlays[name]}}`),
    };
    const found = propertyMap(
      fs.readFileSync("src/shared/api/types.ts", "utf8"),
      name,
    );
    if (
      JSON.stringify(Object.entries(wanted).sort()) !==
      JSON.stringify(Object.entries(found).sort())
    )
      throw new Error(
        `DTO ${name}: ${Object.keys({ ...wanted, ...found })
          .filter((k) => wanted[k] !== found[k])
          .map((k) => `${k}: ${wanted[k]} <> ${found[k]}`)
          .join("; ")}`,
      );
  } else if (actual[name] !== baseline)
    throw new Error(`Базовый DTO ${name} отличается от контракта`);
}
if (Object.keys(actual).length !== Object.keys(expected).length + 1 || !actual.StaffAccount)
  throw new Error("Неизвестные базовые DTO");
function files(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((item) =>
      item.isDirectory()
        ? files(path.join(directory, item.name))
        : [path.join(directory, item.name)],
    );
}
const sources = files("src");
const invalidCss = sources.filter(
  (file) => file.endsWith(".css") && !file.endsWith(".module.css"),
);
if (invalidCss.length)
  throw new Error(`Не CSS Modules: ${invalidCss.join(", ")}`);
const runtime = sources.filter(
  (file) =>
    /\.(ts|tsx)$/.test(file) &&
    !file.includes(`${path.sep}mocks${path.sep}`) &&
    !file.includes(`${path.sep}test${path.sep}`) &&
    !file.includes(".test."),
);
for (const file of runtime) {
  const text = fs.readFileSync(file, "utf8");
  if (
    /\/api\/v1\b|\bparseFloat\s*\(|from\s+['"](?:redux|@reduxjs|tailwind|styled-components)/.test(
      text,
    )
  )
    throw new Error(`Запрещённый runtime-паттерн: ${file}`);
}
console.log(
  `Контракт 2.1.0: базовые и новые DTO совпадают; CSS Modules и runtime-проверки пройдены.`,
);
