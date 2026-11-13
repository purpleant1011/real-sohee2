import { chromium } from 'playwright'
import fs from 'fs'

async function fetchGoogleDriveFolder() {
  const url = 'https://drive.google.com/drive/folders/1RLOOoOg_7NQbFcOj3yWKYbhdo8cUJ7UB?usp=sharing'
  console.log('Fetching Google Drive Folder:', url)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(5000)

  // Extract file names / items from Google Drive UI
  const items = await page.evaluate(() => {
    const list = []
    // Select drive items
    const rows = document.querySelectorAll('[data-id], [role="row"], [role="treeitem"], [data-target="item"], .c-k-t, div[aria-label]')
    rows.forEach(r => {
      const ariaLabel = r.getAttribute('aria-label')
      const text = r.innerText
      if (ariaLabel && !list.includes(ariaLabel)) list.push({ type: 'aria', text: ariaLabel })
      if (text && text.trim().length > 0 && text.length < 200) list.push({ type: 'text', text: text.trim() })
    })

    // Grab all links
    const links = Array.from(document.querySelectorAll('a')).map(a => ({
      href: a.href,
      text: a.innerText,
      ariaLabel: a.getAttribute('aria-label')
    }))

    return { items: list, links, title: document.title }
  })

  console.log('Page Title:', items.title)
  console.log('Extracted Items:', JSON.stringify(items, null, 2))

  await page.screenshot({ path: '/Users/findk/.gemini/antigravity/brain/cfe6c96a-485f-41a5-ab8e-4ad3a98cddc2/gdrive_folder.png', fullPage: true })
  console.log('Screenshot saved to gdrive_folder.png')

  await browser.close()
}

fetchGoogleDriveFolder().catch(console.error)
