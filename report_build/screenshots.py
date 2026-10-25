"""Start the Flask app, capture each tab with Playwright (using an installed Chromium browser), stop the app."""
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "screenshots"
BROWSERS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
]

server = subprocess.Popen([sys.executable, "app.py"], cwd=ROOT,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(40):
        try:
            urllib.request.urlopen("http://127.0.0.1:5050/", timeout=1)
            break
        except OSError:
            time.sleep(0.5)

    OUT.mkdir(exist_ok=True)
    exe = next(b for b in BROWSERS if Path(b).exists())
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=exe, headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900}, device_scale_factor=1.5)

        page.goto("http://127.0.0.1:5050/?theme=light#predict")
        page.wait_for_selector(".kpi .value")
        page.screenshot(path=OUT / "01_predict.png", full_page=True)

        page.select_option("#profession", "Student")
        page.check("input[name=deadline_week]")
        page.click("button.primary")
        page.wait_for_function("document.querySelector('#results h2').innerText.includes('Student')")
        page.screenshot(path=OUT / "02_predict_student_exam_week.png", full_page=True)

        for name, tab, sel in [("03_model_insights", "insights", ".figs img"),
                               ("04_training_data", "data", "#data-body table"),
                               ("05_about", "about", "#about table")]:
            page.click(f".tab[data-tab={tab}]")
            page.wait_for_selector(sel)
            page.wait_for_timeout(800)
            page.screenshot(path=OUT / f"{name}.png", full_page=True)
        browser.close()
    print("saved:", sorted(f.name for f in OUT.glob("0*.png")))
finally:
    server.terminate()
