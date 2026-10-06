// Дорабатывает Android-проект после `tauri android init` (папка src-tauri/gen в git не хранится).
// Приложение рисуется под строкой состояния и кнопками навигации (edge-to-edge), а WebView
// не всегда сообщает странице их размеры через env(safe-area-inset-*). MainActivity передаёт
// отступы системных панелей и высоту клавиатуры сама: window.AndroidInsets.get() и событие
// `androidinsets` — их читает src/insets.ts.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
function find(dir, name) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      const found = find(path, name);
      if (found) return found;
    } else if (entry === name) return path;
  }
  return null;
}
const file = find('src-tauri/gen/android/app/src/main', 'MainActivity.kt');
if (!file) throw new Error('MainActivity.kt не найден — сначала выполните tauri android init');
const pkg = readFileSync(file, 'utf8').match(/^package\s+(\S+)/m)?.[1];
if (!pkg) throw new Error(`В ${file} нет строки package`);
writeFileSync(
  file,
  `package ${pkg}

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  @Volatile private var insets = "{\\"top\\":0,\\"right\\":0,\\"bottom\\":0,\\"left\\":0,\\"keyboard\\":0}"

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(InsetsBridge(), "AndroidInsets")
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, windowInsets ->
      val bars = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
      val d = resources.displayMetrics.density
      insets = "{\\"top\\":\${bars.top / d},\\"right\\":\${bars.right / d}," +
        "\\"bottom\\":\${bars.bottom / d},\\"left\\":\${bars.left / d}," +
        "\\"keyboard\\":\${maxOf(0, ime.bottom - bars.bottom) / d}}"
      (view as WebView).evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('androidinsets', { detail: $insets }))",
        null
      )
      windowInsets
    }
  }

  inner class InsetsBridge {
    @JavascriptInterface
    fun get(): String = insets
  }
}
`,
);
console.log(`Обновлён ${file}`);

// Названия берутся из productName: «Teacher Companion» под значком обрезается до «Teacher Co…».
// RuStore требует, чтобы название под значком совпадало с названием в магазине, — поэтому
// везде полное «Помощник учителя» (узкий лаунчер может показать «Помощник учи…»).
const strings = 'src-tauri/gen/android/app/src/main/res/values/strings.xml';
const labels = { app_name: 'Помощник учителя', main_activity_title: 'Помощник учителя' };
let xml = readFileSync(strings, 'utf8');
for (const [name, label] of Object.entries(labels)) {
  const pattern = new RegExp(`(<string name="${name}">)[^<]*(</string>)`);
  if (!pattern.test(xml)) throw new Error(`В ${strings} нет строки ${name}`);
  xml = xml.replace(pattern, `$1${label}$2`);
}
writeFileSync(strings, xml);
console.log(`Обновлён ${strings}`);
