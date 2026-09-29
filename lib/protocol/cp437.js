'use strict'

// Code page 437 <-> Unicode. Classic strings are 64 bytes of CP437 padded with spaces.
// Clients without the FullCP437 extension only understand printable ASCII (0x20-0x7E).

const LOW = '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼'
const HIGH =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '

const byteToChar = new Array(256)
const charToByte = new Map()

for (let i = 0; i < 256; i++) {
  let ch
  if (i < 0x20) ch = LOW[i]
  else if (i < 0x7F) ch = String.fromCharCode(i)
  else if (i === 0x7F) ch = '⌂'
  else ch = HIGH[i - 0x80]
  byteToChar[i] = ch
  if (i !== 0) charToByte.set(ch, i)
}

function encode (str, fullCP437 = true) {
  const out = []
  for (const ch of String(str)) {
    const code = ch.codePointAt(0)
    if (code >= 0x20 && code < 0x7F) { out.push(code); continue }
    const b = charToByte.get(ch)
    if (b !== undefined && fullCP437) out.push(b)
    else out.push(0x3F) // '?'
  }
  return out
}

function decode (bytes) {
  let s = ''
  for (const b of bytes) s += byteToChar[b]
  return s
}

module.exports = { encode, decode, LOW, HIGH }
