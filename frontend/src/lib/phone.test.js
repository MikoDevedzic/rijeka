// lib/phone.js: which devices are told not to enlarge the page on focus, and what their viewport then says.
import { describe, it, expect } from 'vitest'
import { isIos, viewportOnIos, STACK_FROM, labelsFor, installWay, desktopInstallWay } from './phone'

describe('an iPhone does not enlarge the page when a field is tapped', () => {
  it('knows an iPhone, an iPad, and an iPad that says it is a Mac', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe(true)
    expect(isIos('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true)
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 'MacIntel', 5)).toBe(true)
  })
  it('leaves a Mac, an Android phone and a desktop alone: there the same words would take pinch-zoom away', () => {
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 'MacIntel', 0)).toBe(false)
    expect(isIos('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile Safari/537.36', 'Linux armv81', 5)).toBe(false)
    expect(isIos('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0', 'Win32', 0)).toBe(false)
    expect(isIos()).toBe(false)
  })
  it('adds the limit once and keeps what the page already said', () => {
    const page = 'width=device-width, initial-scale=1.0, viewport-fit=cover'
    expect(viewportOnIos(page)).toBe(`${page}, maximum-scale=1`)
    expect(viewportOnIos(viewportOnIos(page))).toBe(`${page}, maximum-scale=1`)
    expect(viewportOnIos('')).toBe('maximum-scale=1')
  })
  it('a table of four columns stays a table', () => { expect(STACK_FROM).toBe(5) })
})

describe('a wide table read downwards: the heading each cell stands under', () => {
  const names = ['#', 'TYPE', 'STYLE', 'SIDE', 'NOTIONAL EUR', 'SETTLES']
  it('a plain row takes its headings in order', () => { expect(labelsFor(names, [1, 1, 1, 1, 1, 1])).toEqual(names) })
  it('a cell across several columns takes none, and the cells after it still find theirs', () => {
    expect(labelsFor(names, [3, 1, 1, 1])).toEqual(['', 'SIDE', 'NOTIONAL EUR', 'SETTLES'])      // a total: its name across three, then the figures
    expect(labelsFor(names, [1, 5])).toEqual(['#', ''])                                           // a leg's own terms, or a message, across the rest
    expect(labelsFor(names, [6])).toEqual([''])
  })
  it('a cell past the last heading has no label', () => { expect(labelsFor(names, [1, 1, 1, 1, 1, 1, 1])[6]).toBe('') })
})

describe('the taps that put Rijeka on a home screen, by browser', () => {
  const iphone = (rest) => `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${rest}`
  it('follows Safari as it moved its Share button: in the bar, behind the three dots (26), behind the address bar (27)', () => {
    expect(installWay('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('safari')
    expect(installWay(iphone('Version/18.6 Mobile/15E148 Safari/604.1'))).toBe('safari')
    expect(installWay(iphone('Version/26.1 Mobile/15E148 Safari/604.1'))).toBe('safari-26')      // the OS stays 18_6 in the user agent from 26 on
    expect(installWay(iphone('Version/27.0 Mobile/15E148 Safari/604.1'))).toBe('safari-27')
    expect(installWay(iphone('Version/28.0 Mobile/15E148 Safari/604.1'))).toBe('safari-27')      // a later Safari is told what the latest known one is
  })
  it('knows another browser on an iPhone, and a page opened inside another app', () => {
    expect(installWay(iphone('CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1'))).toBe('other-browser')
    expect(installWay(iphone('FxiOS/132.0 Mobile/15E148 Safari/605.1.15'))).toBe('other-browser')
    expect(installWay(iphone('Mobile/15E148'))).toBe('in-app')                                    // a web view names no Safari
    expect(installWay(iphone('Mobile/15E148 Safari/604.1'))).toBe('in-app')                       // nor does one that names Safari and no Version
    expect(installWay(iphone('Version/26.1 Mobile/15E148 Safari/604.1 Snapchat/13.2'))).toBe('in-app')
    expect(installWay(iphone('Mobile/15E148 Safari/604.1 [FBAN/FBIOS;FBAV/480.0]'))).toBe('in-app')
  })
  it('tells an iPad to look in the bar, whatever it says it is', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15'
    expect(installWay(mac, 'MacIntel', 5)).toBe('safari')                                         // an iPad that says it is a Mac
    expect(installWay('Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1')).toBe('safari')
    expect(installWay(mac, 'MacIntel', 0)).toBe('menu')                                           // a Mac is a Mac
  })
  it('leaves every other device to its browser menu', () => {
    expect(installWay('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36')).toBe('menu')
    expect(installWay('')).toBe('menu')
    expect(installWay()).toBe('menu')
  })
})

describe('a monitor: which browsers can give the app a window of its own', () => {
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  const chrome = (os) => `${os} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`
  it('Chrome and Edge, on any desktop', () => {
    expect(desktopInstallWay(chrome(MAC), 'MacIntel', 0)).toBe('chrome')
    expect(desktopInstallWay(chrome(WIN), 'Win32', 0)).toBe('chrome')
    expect(desktopInstallWay(chrome('Mozilla/5.0 (X11; Linux x86_64)'), 'Linux x86_64', 0)).toBe('chrome')
    expect(desktopInstallWay(`${chrome(WIN)} Edg/131.0.0.0`, 'Win32', 0)).toBe('edge')            // Edge names Chrome too: Edge is asked first
  })
  it('Safari on a Mac from version 17, which has Add to Dock, and not before', () => {
    const safari = (v) => `${MAC} AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v} Safari/605.1.15`
    expect(desktopInstallWay(safari('17.0'), 'MacIntel', 0)).toBe('safari-mac')
    expect(desktopInstallWay(safari('26.1'), 'MacIntel', 0)).toBe('safari-mac')
    expect(desktopInstallWay(safari('16.6'), 'MacIntel', 0)).toBe(null)
  })
  it('not Firefox, which cannot, nor a browser it does not know', () => {
    expect(desktopInstallWay(`${WIN} Gecko/20100101 Firefox/132.0`, 'Win32', 0)).toBe(null)
    expect(desktopInstallWay(`${chrome(WIN)} OPR/114.0.0.0`, 'Win32', 0)).toBe(null)
    expect(desktopInstallWay('', '', 0)).toBe(null)
    expect(desktopInstallWay()).toBe(null)
  })
  it('not an iPad or an Android device: those are the home screen\'s', () => {
    expect(desktopInstallWay(`${MAC} AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15`, 'MacIntel', 5)).toBe(null)      // an iPad that says it is a Mac
    expect(desktopInstallWay('Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1')).toBe(null)
    expect(desktopInstallWay('Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Linux armv81', 5)).toBe(null)
  })
})
