# Project instructions

- The owner explicitly authorized publishing subsequent site changes after checks (6 October 2026). Complete implementation, publish to main / GitHub Pages and verify the deployed site without asking for routine publication approval again.
- Preserve the existing top and bottom YouTube cropping in assets/style.css. The owner deliberately uses it to conceal player UI.
- Do not add the playback labels «Подключаемся к эфиру», «Загрузка видео», «Источник недоступен», or a «Вернуться в эфир» button.
- Keep published, already-started broadcasts unchanged. Schedule times use Europe/Minsk (UTC+3).
- Run npm test and npm run check for changes to schedule/player behaviour. Report actual deployed verification separately from unit checks.
- Version frontend asset URLs together on releases to avoid mixing cached HTML, JS and CSS. Browser module imports must use the same asset version.
