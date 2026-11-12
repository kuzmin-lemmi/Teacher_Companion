# Сервер расписания школы (Yandex Cloud Function)

Хранит только **зашифрованные** версии расписания. Ключ шифрования есть у «Бланков» завуча и в QR-коде школы, у сервера его нет. API описано в начале `handler.mjs`.

| Ресурс            | Имя                                           |
| ----------------- | --------------------------------------------- |
| Функция           | `tc-school-api`, Node.js 22, 128 МБ, 10 с     |
| Бакет             | `tc-school-k87`, закрытый                     |
| Сервисный аккаунт | `tc-school`, роль `storage.editor` на каталог |

Доступ функции к бакету — по IAM-токену её сервисного аккаунта (`context.token`). Статических ключей нет.

## Первый запуск (один раз)

Эти команды выдают права, поэтому их выполняет владелец облака:

```powershell
yc resource-manager folder add-access-binding default --role storage.editor --subject serviceAccount:<id сервисного аккаунта tc-school>
yc serverless function allow-unauthenticated-invoke tc-school-api
```

Вторая команда разрешает вызывать функцию без входа в Yandex Cloud: так к ней обращаются «Бланки» и приложение учителя. Без ключа завуча записывать нельзя, а прочитать можно только зашифрованные данные.

## Загрузить новую версию кода

```bash
bash server/yandex/deploy.sh
```

## Тесты

```bash
npx vitest run server
```
