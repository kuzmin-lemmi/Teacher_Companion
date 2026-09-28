//! Общий запуск для Windows и Android. Трей, автозапуск, обновления и единственный
//! экземпляр есть только на компьютере; на телефоне остаются база, диалоги и файлы.
#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg(desktop)]
const MENU_OPEN: &str = "Открыть";
#[cfg(desktop)]
const MENU_TODAY: &str = "Сегодня";
#[cfg(desktop)]
const MENU_NEXT: &str = "Следующий учебный день";
#[cfg(desktop)]
const MENU_SETTINGS: &str = "Настройки";
#[cfg(desktop)]
const MENU_QUIT: &str = "Завершить приложение";

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg(desktop)]
fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial_local_state",
            sql: include_str!("../../src/schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "drafts_and_snapshots",
            sql: include_str!("../../src/schema-v2.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(desktop)]
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", MENU_OPEN, true, None::<&str>)?;
    let today = MenuItem::with_id(app, "today", MENU_TODAY, true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", MENU_NEXT, true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", MENU_SETTINGS, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", MENU_QUIT, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &today, &next, &settings, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("Помощник учителя")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            show_main(app);
            let _ = app.emit("tray-action", event.id.as_ref());
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
                let _ = tray.app_handle().emit("tray-action", "open");
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Единственный экземпляр регистрируется первым, чтобы второй запуск сразу поднял окно.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app);
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    // Сканер QR-кода — перенос расписания с компьютера на телефон.
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![quit_app])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:teacher-companion.db", migrations())
                .build(),
        )
        .setup(|app| {
            #[cfg(desktop)]
            build_tray(app)?;
            #[cfg(mobile)]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Не удалось запустить Помощник учителя");
}
