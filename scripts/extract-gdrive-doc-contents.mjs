import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const ARTIFACT_DIR = '/Users/findk/.gemini/antigravity/brain/cfe6c96a-485f-41a5-ab8e-4ad3a98cddc2/gdrive_docs'
if (!fs.existsSync(ARTIFACT_DIR)) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
}

async function extractAllGDriveDocs() {
  const folderUrl = 'https://drive.google.com/drive/folders/1RLOOoOg_7NQbFcOj3yWKYbhdo8cUJ7UB?usp=sharing'
  console.log('1. Launching browser to open folder and extract doc links...')

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(folderUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(4000)

  // Double click or extract URLs of each file in Google Drive
  // Let's find each item element
  const items = await page.$$('[role="row"], div[aria-label*="Google Docs"], div[aria-label*="Google Sheets"]')
  console.log(`Found ${items.length} item rows`)

  // Alternatively, let's get all links and file identifiers
  const fileData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-id], div[aria-label]'))
    const results = []
    rows.forEach(r => {
      const label = r.getAttribute('aria-label') || ''
      const dataId = r.getAttribute('data-id') || ''
      if (label.includes('Google Docs') || label.includes('Google Sheets') || label.includes('HARNESS') || label.includes('SOHEE')) {
        results.push({ label, dataId })
      }
    })
    return results
  })

  console.log('File metadata:', fileData)

  // Let's click each file or navigate to open preview/export
  // Google Drive items can be opened by double-clicking on the item row
  const itemLabels = [
    'SOHEE Harness Knowledge OS — PRD & Architecture v1.1',
    'SOHEE Harness Knowledge OS — Validation & Gap Review v1.1',
    'SOHEE Harness Registry — v1.1 Admin View',
    'HARNESS — Instagram — noor.brow — v1.1',
    'HARNESS — Instagram — studio_by.reum — v1.1'
  ]

  for (const name of itemLabels) {
    console.log(`\n======================================================`)
    console.log(`Opening: ${name}`)
    console.log(`======================================================`)

    try {
      const row = page.locator(`div:has-text("${name}")`).first()
      if (await row.count() > 0) {
        // Double click to open doc in new tab
        const [newPage] = await Promise.all([
          page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null),
          row.dblclick({ force: true })
        ])

        if (newPage) {
          await newPage.waitForLoadState('networkidle')
          await newPage.waitForTimeout(4000)
          console.log(`Opened doc URL: ${newPage.url()}`)
          
          // Extract text content
          const docText = await newPage.evaluate(() => {
            const body = document.querySelector('.kix-appview-editor, .docs-editor, #canvas-container, [role="document"], body')
            return body ? body.innerText : document.body.innerText
          })

          const cleanName = name.replace(/[/\\?%*:|"<>]/g, '_')
          const outPath = path.join(ARTIFACT_DIR, `${cleanName}.txt`)
          fs.writeFileSync(outPath, docText, 'utf-8')
          console.log(`Saved ${docText.length} chars to ${outPath}`)

          await newPage.screenshot({ path: path.join(ARTIFACT_DIR, `${cleanName}.png`), fullPage: false })
          await newPage.close()
        } else {
          console.log('No new tab opened, trying direct export / view...')
        }
      }
    } catch (e) {
      console.error(`Error extracting ${name}:`, e.message)
    }
  }

  await browser.close()
}

extractAllGDriveDocs().catch(console.error)
