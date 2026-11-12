# Бланки расписания — программа завуча

Читает выгрузку **aSc Расписание** (XML) и делает из неё бланки для печати (учителя, классы, замены), картинки и текст для чатов, а также проверяет ошибки aSc. Сборка — один файл `dist-blanki/index.html`: он открывается двойным щелчком, без установки и интернета.

Код школы общий с приложением: `src/school/` (разбор aSc, формат `tc-school/1`, проверка, текст для чата, сравнение версий). Исправление в разборе сразу действует и в «Бланках», и в Teacher Companion.

```bash
npm run blanki:dev     # http://127.0.0.1:1430
npm run blanki:build   # → dist-blanki/index.html
```

Сверка с настоящей выгрузкой (файлы с ФИО коллег в репозиторий не класть):

```bash
SCHOOL_XML=../1.xml npx vitest run blanki/verify
SCHOOL_XML=../1.xml SCHOOL_DAY_SHEET=../friday.txt SCHOOL_DAY=5 npx vitest run blanki/verify
```

Тест проверяет, что каждая карточка XML попала в расписание ровно один раз. Если передать расшифровку бумажной распечатки дня, он сверит её урок за уроком.

План школьной версии — в репозитории `Teacher_Companion_School`, `docs/07-plan-integration.md` и `docs/08-pilot-plan.md`.
