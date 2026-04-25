import JSZip from 'jszip'
import jsPDF from 'jspdf'
import { getPage } from './storage'
import type { DownloadInfo } from '../types'

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function safeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

export async function generateChapterPDF(
  chapterId: string,
  info: DownloadInfo,
): Promise<Blob> {
  let pdf: jsPDF | null = null

  for (let i = 0; i < info.totalPages; i++) {
    const blob = await getPage(chapterId, i)
    if (!blob) continue

    const dataUrl = await blobToDataUrl(blob)
    const img = await loadImage(dataUrl)
    const w = img.naturalWidth
    const h = img.naturalHeight

    if (!pdf) {
      pdf = new jsPDF({ unit: 'px', format: [w, h], compress: true })
    } else {
      pdf.addPage([w, h])
    }

    const fmt = blob.type.includes('png') ? 'PNG' : 'JPEG'
    pdf.addImage(dataUrl, fmt, 0, 0, w, h)
  }

  if (!pdf) throw new Error('No pages found in IndexedDB for this chapter')
  return pdf.output('blob')
}

export async function downloadChapterAsPDF(chapterId: string, info: DownloadInfo) {
  const blob = await generateChapterPDF(chapterId, info)
  const filename = safeFilename(
    `${info.mangaTitle ?? 'manga'} - Ch${info.chapterNumber ?? '?'}.pdf`,
  )
  triggerDownload(blob, filename)
}

export async function downloadAllChaptersAsZip(
  chapters: Array<{ chapterId: string; info: DownloadInfo }>,
  mangaTitle: string,
  onProgress: (done: number, total: number) => void,
) {
  const zip = new JSZip()
  const folder = zip.folder(safeFilename(mangaTitle)) ?? zip

  for (let i = 0; i < chapters.length; i++) {
    const { chapterId, info } = chapters[i]
    onProgress(i, chapters.length)
    const pdfBlob = await generateChapterPDF(chapterId, info)
    const num = String(info.chapterNumber ?? i + 1).padStart(4, '0')
    folder.file(`Ch${num}.pdf`, pdfBlob)
  }

  onProgress(chapters.length, chapters.length)
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  triggerDownload(zipBlob, `${safeFilename(mangaTitle)}.zip`)
}
