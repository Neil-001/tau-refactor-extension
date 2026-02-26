import { initializeApp } from "firebase/app"
import { doc, getDoc, setDoc, getFirestore } from "firebase/firestore"
import { inflate, gzip } from "pako"

const arraysEqual = (a: any[], b: any[]) => {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

const app = initializeApp({
  apiKey: "AIzaSyCgybLzJBR_F9bUWPNnhJX4g4ljsl2bNOs",
  authDomain: "tau-factor.firebaseapp.com",
  projectId: "tau-factor",
  storageBucket: "tau-factor.firebasestorage.app",
  messagingSenderId: "452490897379",
  appId: "1:452490897379:web:f123bf1092fa254bd5a2d6",
})

const firestore = getFirestore(app)

const getData = async (semester: string) => {
  let document = await getDoc(doc(firestore, `/grades/${semester}`))
  let docData = document.data() ?? {}
  let decodedData = atob(docData["data"])
  let gzippedData = new Uint8Array(decodedData.length)
  for (let i = 0; i < decodedData.length; i++) {
    gzippedData[i] = decodedData.charCodeAt(i)
  }

  let stringData = inflate(gzippedData, { to: "string" })
  const data = JSON.parse(stringData)
  chrome.storage.local.set({
    [`lastFetch-${semester}`]: new Date().toString(),
    [`data-${semester}`]: data,
  })
  return data
}

const addGrades = async (
  semester: string,
  courseId: string,
  gradeInfos: Record<string, any[]>,
) => {
  const data = await getData(semester)
  if (data[courseId]) {
    return
  }
  data[courseId] = gradeInfos
  const stringData = JSON.stringify(data)
  const gzippedData = gzip(stringData)
  let decodedData = ""
  for (var i = 0; i < gzippedData.byteLength; i++) {
    decodedData += String.fromCharCode(gzippedData[i])
  }
  await setDoc(doc(firestore, `/grades/${semester}`), {
    data: btoa(decodedData),
  })
  chrome.storage.local.set({
    [`lastFetch-${semester}`]: new Date().toString(),
    [`data-${semester}`]: data,
  })
}

let shouldSendData = false
let groupOptions: string[] = []
let moedOptions: string[] = []
let finished: any[] = []
let gData: Record<string, any[]> = {}
let group = ""
let courseId = ""
let semester = ""

const handler = async (
  request: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) => {
  if (
    !sender.url?.startsWith("https://ims.tau.ac.il/") &&
    !sender.url?.startsWith("https://my.tau.ac.il/")
  ) {
    return
  }

  if (request.type === "addGrades") {
    await addGrades(request.semester, request.courseId, request.gradeInfos)
    sendResponse({ success: true })
  } else if (request.type === "setShouldSendData") {
    shouldSendData = request.shouldSendData
    sendResponse()
  } else if (request.type === "shouldSendData") {
    sendResponse(shouldSendData)
  } else if (request.type === "getData") {
    if (request.semester.endsWith("all_year")) {
      const year = request.semester.slice(0, 4)
      const semesters = [year + "a", year + "b"]
      const result = await chrome.storage.local.get([
        `lastFetch-${semesters[0]}`,
        `data-${semesters[0]}`,
        `lastFetch-${semesters[1]}`,
        `data-${semesters[1]}`,
      ])
      const allData: any = {}
      for (const semester of semesters) {
        const lastFetch = result[`lastFetch-${semester}`] ?? new Date("2019")
        let data = result[`data-${semester}`]
        if (Date.now() - new Date(lastFetch).getTime() > 1000 * 60 * 60 * 24) {
          console.log(`Data outdated for ${semester}, refreshing`)
          data = await getData(semester)
        }
        allData[semester] = data
      }
      sendResponse(allData)
      return
    }
    const result = await chrome.storage.local.get([
      `lastFetch-${request.semester}`,
      `data-${request.semester}`,
    ])
    const lastFetch =
      result[`lastFetch-${request.semester}`] ?? new Date("2019")
    let data = result[`data-${request.semester}`]
    if (Date.now() - new Date(lastFetch).getTime() > 1000 * 60 * 60 * 24) {
      console.log(`Data outdated for ${request.semester}, refreshing`)
      data = await getData(request.semester)
    }
    sendResponse({ [request.semester]: data })
  } else if (request.type === "sendData") {
    if (
      !arraysEqual(groupOptions, request.groupOptions) ||
      !arraysEqual(moedOptions, request.moedOptions)
    ) {
      groupOptions = request.groupOptions
      moedOptions = request.moedOptions
      finished = []
      gData = {}
      group = ""
      courseId = ""
      semester = ""
    }

    if (request.group) {
      group = request.group
    }
    if (request.courseId) {
      courseId = request.courseId
    }
    if (request.semester) {
      semester = request.semester
    }

    if (
      !finished.some(
        ([group, moed]) => group === request.group && moed === request.moed,
      )
    ) {
      if (request.distribution) {
        const newData: any = {
          moed: parseInt(request.moed, 10),
          distribution: request.distribution,
        }
        if (request.mean) {
          newData.mean = request.mean
        }
        if (request.median) {
          newData.median = request.median
        }
        if (request.standardDeviation) {
          newData.standard_deviation = request.standardDeviation
        }
        if (!gData[group]) {
          gData[group] = []
        }
        gData[group].push(newData)
      }
      finished.push([request.group, request.moed])
    }

    for (const group of groupOptions) {
      for (const moed of moedOptions) {
        if (!finished.some(([g, m]) => group === g && moed === m)) {
          sendResponse({ type: "setGroupAndMoed", group, moed })
          return
        }
      }
    }

    sendResponse({ type: "finish" })
    shouldSendData = false
    await addGrades(semester, courseId, gData)
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handler(request, sender, sendResponse)

  return true
})
