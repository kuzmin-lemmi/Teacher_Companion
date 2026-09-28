//! Телефон: расписание в шторке, напоминания перед уроком и виджеты на рабочем столе.
//! Вся работа — в Kotlin (android/): приложение передаёт готовый план уроков на несколько
//! недель, а уведомления и виджеты обновляются по будильнику, даже когда приложение закрыто.
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("lessons")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin("ru.teachercompanion.lessons", "LessonsPlugin")?;
            Ok(())
        })
        .build()
}
