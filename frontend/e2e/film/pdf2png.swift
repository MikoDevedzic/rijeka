// pdf2png <in.pdf> <out prefix> <scale>: each page of a PDF as a PNG (CoreGraphics, which macOS ships). For workbook.sh.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
let a = CommandLine.arguments
let doc = CGPDFDocument(URL(fileURLWithPath: a[1]) as CFURL)!
let scale = CGFloat(Double(a[3]) ?? 2)
print("pages", doc.numberOfPages)
for i in 1...doc.numberOfPages {
  let page = doc.page(at: i)!; let box = page.getBoxRect(.mediaBox)
  let w = Int(box.width * scale), h = Int(box.height * scale)
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: scale, y: scale); ctx.drawPDFPage(page)
  let dst = CGImageDestinationCreateWithURL(URL(fileURLWithPath: "\(a[2])-\(i).png") as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dst, ctx.makeImage()!, nil); CGImageDestinationFinalize(dst)
  print(i, w, h)
}
