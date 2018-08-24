#!/usr/bin/env node

const axios = require('axios')
const fs = require('fs')
const path = require('path')
const util = require('util')
const readFileAsync = util.promisify(fs.readFile)
const writeFileAsync = util.promisify(fs.writeFile)

async function getLatestIRIReleaseVersion() {
  const latestReleaseInfo = await axios.get('https://api.github.com/repos/iotaledger/iri/releases/latest')
  return latestReleaseInfo.data.tag_name.replace('v', '')
}

async function updateVersionInFile({ filePath, replaceField, version }) {
  const fileData = await readFileAsync(filePath, 'utf8')
  const newFileData = fileData.replace(new RegExp(`${replaceField}: '.*',`, 'g'), `${replaceField}: '${version}',`)
  await writeFileAsync(filePath, newFileData, 'utf8')
}

async function updateIRIVersions() {
  const version = await getLatestIRIReleaseVersion()

  await updateVersionInFile({
    filePath: path.join(__dirname, '..', 'src', 'settings.js'),
    replaceField: 'databaseVersion',
    version,
  })
  await updateVersionInFile({
    filePath: path.join(__dirname, '..', 'src', 'installer', 'database-installer.js'),
    replaceField: 'databaseVersion',
    version,
  })
  await updateVersionInFile({
    filePath: path.join(__dirname, '..', 'src', 'installer', 'iri-installer.js'),
    replaceField: 'latestVersion',
    version,
  })
  console.log(`Updated IRI versions to ${version}`)
}

updateIRIVersions().then(() => {})