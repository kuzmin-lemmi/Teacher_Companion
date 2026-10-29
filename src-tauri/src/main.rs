#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    teacher_companion_lib::run();
}

/// Загрузчик WebView2 (WebView2LoaderStatic.lib) импортирует EventSetInformation из advapi32,
/// а в Windows 7 она есть только с обновлением KB3080149 — без него программа не запустится:
/// «Точка входа не найдена». Подменяем импорт: если функция в системе есть, вызываем её,
/// иначе загрузчик просто остаётся без телеметрии.
#[cfg(target_vendor = "win7")]
mod event_set_information {
    use std::ffi::c_void;

    type EventSetInformation = unsafe extern "system" fn(u64, i32, *const c_void, u32) -> u32;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> *mut c_void;
        fn GetProcAddress(module: *mut c_void, name: *const u8) -> *mut c_void;
    }

    unsafe extern "system" fn shim(handle: u64, class: i32, info: *const c_void, len: u32) -> u32 {
        const ERROR_NOT_SUPPORTED: u32 = 50;
        let advapi32: Vec<u16> = "advapi32.dll\0".encode_utf16().collect();
        let module = GetModuleHandleW(advapi32.as_ptr());
        if module.is_null() {
            return ERROR_NOT_SUPPORTED;
        }
        let real = GetProcAddress(module, b"EventSetInformation\0".as_ptr());
        if real.is_null() {
            return ERROR_NOT_SUPPORTED;
        }
        std::mem::transmute::<*mut c_void, EventSetInformation>(real)(handle, class, info, len)
    }

    #[allow(non_upper_case_globals)]
    #[no_mangle]
    #[used]
    static __imp_EventSetInformation: EventSetInformation = shim;
}
