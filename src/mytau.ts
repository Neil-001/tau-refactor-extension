const HEBREW_SEMESTER_TO_SUFFIX: Record<string, string> = {
  א: "a",
  ב: "b",
  קיץ: "summer",
  שנתי: "all_year",
}

const parseSemester = (text: string): string => {
  // e.g. "2024 סמסטר א'" → "2025a"
  const yearMatch = text.match(/(\d{4})/)
  if (!yearMatch) return ""
  const year = (parseInt(yearMatch[1], 10) + 1).toString()

  if (text.includes("שנתי")) return year + "all_year"
  if (text.includes("קיץ")) return year + "summer"

  const letterMatch = text.match(/סמסטר\s*([א-ת])'?/)
  if (!letterMatch) return year + "all_year"
  return year + (HEBREW_SEMESTER_TO_SUFFIX[letterMatch[1]] ?? "a")
}

const getDistribution = (): number[] => {
  const cols = document.querySelectorAll(
    ".chard .chard-axis-column:not(.chard-top-col)",
  )
  const dist: number[] = []
  cols.forEach((col) => {
    const bar = col.querySelector("div[val]")
    const valStr = bar?.getAttribute("val")
    const val = parseInt(valStr || "0", 10)
    dist.push(isNaN(val) ? 0 : val)
  })
  return dist
}

const getStat = (label: string): number | undefined => {
  const el = Array.from(document.querySelectorAll(".font-size-label")).find(
    (e) => e.textContent?.trim() === label,
  )
  if (!el?.nextElementSibling) return undefined
  const v = parseFloat(el.nextElementSibling.textContent?.trim() ?? "")
  return isNaN(v) ? undefined : v
}

const waitForChartChange = (prev: number[], ms = 4000): Promise<boolean> =>
  new Promise((resolve) => {
    const deadline = Date.now() + ms
    const poll = () => {
      const curr = getDistribution()
      if (curr.length > 0 && JSON.stringify(curr) !== JSON.stringify(prev)) {
        resolve(true)
        return
      }
      if (Date.now() > deadline) {
        resolve(false)
        return
      }
      setTimeout(poll, 150)
    }
    setTimeout(poll, 200)
  })

const triggerChange = (el: HTMLSelectElement, value: string) => {
  el.value = value
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

const scrapeAllData = async () => {
  // Scope searches to the popup container if present
  const popup: ParentNode =
    document.getElementById("DeviationPopupContainer") ?? document.body

  // Course ID — 8-digit number
  const courseIdEl = Array.from(popup.querySelectorAll("*")).find(
    (e) =>
      e.childElementCount === 0 && /^\d{8}$/.test(e.textContent?.trim() ?? ""),
  )
  if (!courseIdEl) return null
  const courseId = courseIdEl.textContent!.trim()

  // Semester — "2024 סמסטר א'"
  const semesterEl = Array.from(
    document.querySelectorAll(".white-space-nowrap"),
  ).find((e) => e.childElementCount === 0 && e.textContent?.includes("סמסטר"))
  if (!semesterEl) {
    console.error("[TAU Refactor] Semester element not found!")
    return null
  }
  const semester = parseSemester(semesterEl.textContent!.trim())
  if (!semester) {
    console.error(
      `[TAU Refactor] Failed to parse semester text: "${semesterEl.textContent!.trim()}"`,
    )
    return null
  }

  const moedSel = document.getElementById(
    "Dropdown1",
  ) as HTMLSelectElement | null
  const grpSel = document.getElementById(
    "Dropdown3",
  ) as HTMLSelectElement | null
  if (!moedSel) return null

  const moedOpts = Array.from(moedSel.options)
  const grpOpts = grpSel
    ? Array.from(grpSel.options)
    : [{ value: "0", text: "00" } as HTMLOptionElement]

  const gradeInfos: Record<string, any[]> = {}

  const buildEntry = (moed: number) => {
    const distribution = getDistribution()
    if (distribution.length === 0 || distribution.every((v) => v === 0))
      return null
    const entry: Record<string, any> = { moed, distribution }
    const mean = getStat("ממוצע")
    const median = getStat("חציון")
    const stdDev = getStat("סטיית תקן")
    if (mean !== undefined) entry.mean = mean
    if (median !== undefined) entry.median = median
    if (stdDev !== undefined) entry.standard_deviation = stdDev
    return entry
  }

  for (const grpOpt of grpOpts) {
    const groupKey = grpOpt.text.trim()

    // Switch group if needed
    if (grpSel && grpSel.value !== grpOpt.value) {
      const prev = getDistribution()
      triggerChange(grpSel, grpOpt.value)
      await waitForChartChange(prev)
    }

    // Read the currently displayed moed WITHOUT triggering a reload —
    // firing a change event on the already-selected value causes OutSystems
    // to clear the chart during a refetch, making getDistribution() return
    // all zeros before the new data arrives.
    const initialMoedValue = moedSel.value
    const initialMoed = parseInt(initialMoedValue, 10) + 1
    const initialEntry = buildEntry(initialMoed)
    if (initialEntry) {
      if (!gradeInfos[groupKey]) gradeInfos[groupKey] = []
      gradeInfos[groupKey].push(initialEntry)
    }

    // Now cycle through every other moed
    for (const moedOpt of moedOpts) {
      if (moedOpt.value === initialMoedValue) continue // already captured above

      const moed = parseInt(moedOpt.value, 10) + 1
      const prev = getDistribution()
      triggerChange(moedSel, moedOpt.value)
      const changed = await waitForChartChange(prev)
      if (!changed) continue // moed likely has no data

      const entry = buildEntry(moed)
      if (!entry) continue
      if (!gradeInfos[groupKey]) gradeInfos[groupKey] = []
      gradeInfos[groupKey].push(entry)
    }

    // Restore the initial moed so the popup looks unchanged after scraping
    if (moedSel.value !== initialMoedValue) {
      triggerChange(moedSel, initialMoedValue)
    }
  }

  return { courseId, semester, gradeInfos }
}

// ── Button injection & UI State ──────────────────────────────────────────────────

let scrapeState: "idle" | "loading" | "success" | "error" | "empty" = "idle"

const syncButtonUI = (btn: HTMLButtonElement) => {
  btn.style.cssText =
    "margin-top:12px;width:100%;padding:8px 16px;border:none;direction:rtl" +
    "color:white;cursor:pointer;" +
    "border-radius:10px;font-size:14px;font-weight:bold;"

  switch (scrapeState) {
    case "idle":
      btn.innerText = "הוסף ל-TAU Refactor"
      btn.style.backgroundColor = "rgb(19,152,255)"
      btn.disabled = false
      break
    case "loading":
      btn.innerText = "טוען... (נא לא לסגור)"
      btn.style.backgroundColor = "rgb(19,152,255)"
      btn.disabled = true
      break
    case "success":
      btn.innerText = "נוסף בהצלחה! ✓"
      btn.style.backgroundColor = "rgb(40,167,69)"
      btn.disabled = false
      break
    case "error":
      btn.innerText = "שגיאה בהוספה (ראה קונסולה)"
      btn.style.backgroundColor = "rgb(220,53,69)"
      btn.disabled = false
      break
    case "empty":
      btn.innerText = "אין נתונים להוספה"
      btn.style.backgroundColor = "rgb(108,117,125)"
      btn.disabled = false
      break
  }
}

const updateGlobalButtonUI = () => {
  const btn = document.getElementById(
    "tau-refactor-add-btn",
  ) as HTMLButtonElement | null
  if (btn) syncButtonUI(btn)
}

const injectAddButton = (chartEl: Element) => {
  if (document.getElementById("tau-refactor-add-btn")) return

  const btn = document.createElement("button") as HTMLButtonElement
  btn.id = "tau-refactor-add-btn"
  syncButtonUI(btn)

  btn.onclick = async () => {
    if (scrapeState === "loading") return
    scrapeState = "loading"
    updateGlobalButtonUI()

    try {
      const result = await scrapeAllData()

      if (!result || Object.keys(result.gradeInfos).length === 0) {
        scrapeState = "empty"
        updateGlobalButtonUI()
        setTimeout(() => {
          if (scrapeState === "empty") {
            scrapeState = "idle"
            updateGlobalButtonUI()
          }
        }, 3000)
        return
      }

      const { courseId, semester, gradeInfos } = result

      // Log full scraped payload for local verification
      console.log(
        "[TAU Refactor] Course data:",
        JSON.stringify({ courseId, semester, gradeInfos }, null, 2),
      )

      await chrome.runtime.sendMessage({
        type: "addGrades",
        semester,
        courseId,
        gradeInfos,
      })

      scrapeState = "success"
      updateGlobalButtonUI()
    } catch (e) {
      console.error("[TAU Refactor] Error:", e)
      scrapeState = "error"
      updateGlobalButtonUI()
    }
  }

  // Insert after the TAUChart block, or directly after the chart div
  const chartBlock = chartEl.closest('[data-block="TAUControls.TAUChart"]')
  const container = chartBlock?.parentElement ?? chartEl.parentElement
  container?.appendChild(btn)
}

// ── Page observer ─────────────────────────────────────────────────────────────

const tryInjectButton = () => {
  const popup = document.getElementById("DeviationPopupContainer")
  if (!popup) {
    // Popup is closed — clean up so next open gets a fresh button
    document.getElementById("tau-refactor-add-btn")?.remove()
    scrapeState = "idle"
    return
  }

  const chartEl = document.querySelector(".chard")
  if (chartEl) {
    injectAddButton(chartEl)
  }
}

const pageObserver = new MutationObserver(tryInjectButton)
pageObserver.observe(document.body, { childList: true, subtree: true })
tryInjectButton()
