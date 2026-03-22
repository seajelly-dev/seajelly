#!/usr/bin/env node

/**
 * SEAJelly — WeChat iLink Bot Login Script
 *
 * Zero-dependency login tool for the WeChat ClawBot / iLink Bot API.
 * Performs QR code login and prints the bot_token needed for Edge Gateway.
 *
 * Usage:  node login.mjs
 * Requires: Node.js >= 18 (uses built-in fetch)
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const API_BASE = 'https://ilinkai.weixin.qq.com'
const CRED_DIR = join(homedir(), '.weixin-bot')
const CRED_PATH = join(CRED_DIR, 'credentials.json')

async function getQrCode() {
  const resp = await fetch(`${API_BASE}/ilink/bot/get_bot_qrcode?bot_type=3`)
  if (!resp.ok) throw new Error(`get_bot_qrcode failed: ${resp.status}`)
  return await resp.json()
}

async function pollQrStatus(qrcodeToken) {
  const resp = await fetch(
    `${API_BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcodeToken)}`,
    { headers: { 'iLink-App-ClientVersion': '1' } },
  )
  if (!resp.ok) throw new Error(`get_qrcode_status failed: ${resp.status}`)
  return await resp.json()
}

function printQrToTerminal(url) {
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║  Scan the QR code with WeChat        ║')
  console.log('╚══════════════════════════════════════╝')
  console.log()
  console.log(`QR URL: ${url}`)
  console.log()
  console.log('Open this URL in a browser if your terminal cannot display it,')
  console.log('then scan the QR code shown on the page with WeChat.')
  console.log()
}

function saveCredentials(data) {
  mkdirSync(CRED_DIR, { recursive: true })
  writeFileSync(CRED_PATH, JSON.stringify(data, null, 2))
}

function loadCredentials() {
  if (!existsSync(CRED_PATH)) return null
  try {
    return JSON.parse(readFileSync(CRED_PATH, 'utf-8'))
  } catch {
    return null
  }
}

async function login() {
  console.log('SEAJelly — WeChat iLink Bot Login')
  console.log('==================================\n')

  const existing = loadCredentials()
  if (existing?.token) {
    console.log(`Found existing credentials at ${CRED_PATH}`)
    console.log(`  token:   ${existing.token.slice(0, 20)}...`)
    console.log(`  userId:  ${existing.userId || 'unknown'}`)
    console.log(`  baseUrl: ${existing.baseUrl || API_BASE}`)
    console.log()
    console.log('To force re-login, delete the file and run again:')
    console.log(`  rm ${CRED_PATH}`)
    console.log()

    printResult(existing)
    return
  }

  console.log('Requesting QR code...')
  const qrData = await getQrCode()
  const qrcodeToken = qrData.qrcode
  const qrImageUrl = qrData.qrcode_img_content

  if (!qrcodeToken) {
    throw new Error('Failed to get QR code token. Response: ' + JSON.stringify(qrData))
  }

  printQrToTerminal(qrImageUrl || `https://ilinkai.weixin.qq.com/ilink/bot/qrcode?token=${qrcodeToken}`)

  console.log('Waiting for scan...\n')

  const maxAttempts = 120
  for (let i = 0; i < maxAttempts; i++) {
    await delay(2000)

    const status = await pollQrStatus(qrcodeToken)

    switch (status.status) {
      case 'wait':
        if (i % 10 === 0 && i > 0) {
          process.stdout.write(`  Still waiting... (${i * 2}s)\n`)
        }
        break

      case 'scaned':
        process.stdout.write('  Scanned! Waiting for confirmation...\n')
        break

      case 'confirmed': {
        console.log('\n  Confirmed!\n')

        const creds = {
          token: status.bot_token,
          userId: status.ilink_user_id || status.ilink_bot_id || '',
          baseUrl: status.baseurl || API_BASE,
        }

        saveCredentials(creds)
        console.log(`Credentials saved to ${CRED_PATH}\n`)
        printResult(creds)
        return
      }

      case 'expired':
        throw new Error('QR code expired. Please run the script again.')

      default:
        process.stdout.write(`  Status: ${status.status}\n`)
    }
  }

  throw new Error('Login timed out after 4 minutes.')
}

function printResult(creds) {
  console.log('┌──────────────────────────────────────────────┐')
  console.log('│  Copy the token below into Supabase          │')
  console.log('│  system_settings table:                       │')
  console.log('│                                              │')
  console.log(`│  key:   weixin_bot_token                     │`)
  console.log(`│  value: ${creds.token}`)
  console.log('│                                              │')
  console.log('│  Then restart Edge Gateway.                  │')
  console.log('└──────────────────────────────────────────────┘')
}

login().catch((err) => {
  console.error('\nLogin failed:', err.message)
  process.exit(1)
})
