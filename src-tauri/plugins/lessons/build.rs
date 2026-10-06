// Команды выполняет Kotlin-часть (android/); отсюда — только права на их вызов.
const COMMANDS: &[&str] = &["sync", "status", "notifications", "battery", "pin", "preview"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
