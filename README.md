# RIMS

Система управления рестораном: ингредиенты и рецептуры, склад и сроки годности,
поставки, заказы, стоп-лист, предложения и интеграции с поставщиками и кассами.
Три интерфейса на React + TypeScript + CSS Modules, backend на ASP.NET Core 10,
база PostgreSQL. Стоп-лист и доступность блюд при оформлении заказа обновляются
через WebSocket. Мониторинг — Prometheus и Grafana.

## Локальный запуск

Нужны **Docker с Compose v2** и **PowerShell** (`powershell` на Windows или
`pwsh`). Команды выполняются из корня репозитория.

1. Создайте локальную конфигурацию:

   ```powershell
   Copy-Item scripts/live.env.example scripts/local.env
   ```

   В `scripts/local.env` задайте собственный `RIMS_DB_PASSWORD`. Остальные значения
   подходят для запуска на `http://localhost:3288`. Файл с паролями исключён из Git.

2. Соберите и запустите приложение:

   ```powershell
   ./scripts/live.ps1 -EnvFile local.env -Action build
   ./scripts/live.ps1 -EnvFile local.env -Action up
   ./scripts/live.ps1 -EnvFile local.env -Action ready
   ```

   PostgreSQL и миграции запускаются автоматически. Команда `ready` должна вернуть
   `{"status":"ok"}`. Если backend ещё запускается, повторите `ready` через
   несколько секунд. При первой сборке Docker загружает образы и зависимости.

3. Создайте первого супер-администратора:

   ```powershell
   $env:Bootstrap__Username = 'admin'
   $env:Bootstrap__Password = 'replace-with-your-password-12plus'
   ./scripts/live.ps1 -EnvFile local.env -Action bootstrap
   Remove-Item Env:Bootstrap__Password
   ```

   Замените пример пароля своим (не менее 12 символов). Bootstrap выполняется один
   раз: существующего супер-администратора команда не перезаписывает.

Откройте:

| Интерфейс | Адрес |
| --- | --- |
| Рабочее место сотрудников | http://localhost:3288/ |
| Клиент | http://localhost:3288/client/ |
| Поставщик | http://localhost:3288/supplier/ |

База изначально пустая. В основном интерфейсе зарегистрируйте владельца и создайте
предприятие под супер-администратором, затем добавьте ингредиенты, блюда и поставки.
Для клиентского интерфейса нужна отдельная регистрация и публикация ресторана
в настройках предприятия. Для поставщика создайте интеграцию типа «Поставщик»,
выпустите ключ и используйте его вместе с UUID склада. Общих демо-аккаунтов нет.

Логи и остановка с сохранением данных:

```powershell
./scripts/live.ps1 -EnvFile local.env -Action logs
./scripts/live.ps1 -EnvFile local.env -Action stop
```

## Мониторинг — опционально

Дополнительно нужен **Python 3**, доступный командой `python`.

```powershell
./grafana/scripts/init-local.ps1
./scripts/live.ps1 -EnvFile local.env -Monitoring -Action up
```

Grafana: http://localhost:3288/grafana/; логин `monitor-admin`, пароль — в локальном
файле `grafana/secrets/admin_password`. Генератор подключает настоящий backend.
Отправка Telegram/email по умолчанию выключена. Секреты и сгенерированные
конфигурации мониторинга в Git не хранятся. При остановке мониторинга добавьте
`-Monitoring` к команде `stop`.

## Разработка

Основные каталоги: `backend`, `frontend`, `customer_frontend`, `supplier_frontend`.
Общие контракты и браузерные модули — в `packages`; локальный стек — в `scripts`.

Для работы вне Docker нужны .NET SDK из `backend/global.json` и Node.js 22+.
Установите npm-зависимости в `packages/demo-api` и каждом интерфейсе командой
`npm ci --prefix <каталог>`. Проверки:

```powershell
npm --prefix frontend run check:contract
npm --prefix frontend test
npm --prefix customer_frontend test
npm --prefix supplier_frontend test
dotnet test backend/RestaurantManagement.slnx
```

Backend-тесты используют изолированный PostgreSQL через Docker/Testcontainers.