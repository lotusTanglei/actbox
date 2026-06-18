// src/components/RichTextEditor.tsx
// 富文本邮件编辑器（TipTap v3）+ AI 润色入口。
// body 以 HTML 字符串形式受控：value / onChange。

'use client'

import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, FontSize } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Image from '@tiptap/extension-image'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { debounce } from '@/lib/utils/debounce'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  /** 粘贴/拖入图片时回调:上传后返回 cid(插入 <img src="cid:...">);失败返回 undefined。plan-04 Task 9 */
  onInlineImage?: (file: File) => Promise<string | undefined>
  /** debounced 自动保存回调(停顿 debounceMs 后触发;卸载时 flush 最后值)。plan-05 Task 7 */
  onChangeDebounced?: (html: string) => void
  debounceMs?: number
}

const FONT_SIZES = ['12px', '14px', '16px', '18px', '24px', '32px']

type PolishAction = 'grammar' | 'formal' | 'friendly' | 'concise' | 'custom'

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** 把纯文本润色结果转成 HTML 段落（单换行转 <br>） */
const textToHtml = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')

/** 工具栏按钮（定义在模块级，避免每次渲染重建组件类型导致重挂/失焦） */
function Tool({
  label,
  title,
  onClick,
  active,
}: {
  label: React.ReactNode
  title: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-7 min-w-[28px] items-center justify-center rounded px-1.5 text-xs transition-colors ${
        active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent'
      }`}
    >
      {label}
    </button>
  )
}

export function RichTextEditor({ value, onChange, onInlineImage, onChangeDebounced, debounceMs = 8000 }: RichTextEditorProps) {
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  const lastEmitted = useRef(value)
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null)
  const inlineCbRef = useRef(onInlineImage)
  useEffect(() => {
    inlineCbRef.current = onInlineImage
  }, [onInlineImage])

  // debounced 自动保存:停顿 debounceMs(≤10s 要求)触发;卸载 flush 最后值防丢失
  const autosaveRef = useRef<((html: string) => void) | null>(null)
  useEffect(() => {
    if (!onChangeDebounced) return
    const d = debounce(onChangeDebounced, debounceMs)
    autosaveRef.current = d
    return () => {
      d.flush()
      autosaveRef.current = null
    }
  }, [onChangeDebounced, debounceMs])

  // 粘贴/拖入图片 → 上传拿 cid → 插入 <img src="cid:...">;调用方(ComposeMail)登记为内联附件
  const ingestImage = async (file: File) => {
    const cb = inlineCbRef.current
    if (!cb) return
    const cid = await cb(file)
    if (cid) {
      editorRef.current?.chain().focus().setImage({ src: `cid:${cid}` }).run()
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit, // v3 自带：Document/Paragraph/Text/Heading/Bold/Italic/Strike/Code/CodeBlock/Lists/Blockquote/Underline/Link 等
      TextStyle,
      Color,
      Highlight,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      FontSize,
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      lastEmitted.current = html
      onChangeRef.current(html)
      autosaveRef.current?.(html)
    },
    editorProps: {
      attributes: {
        class:
          'min-h-[260px] w-full rounded-md border border-input bg-input px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus:border-primary',
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (file) {
              void ingestImage(file)
              return true // 阻止默认粘贴,改插 cid 图片
            }
          }
        }
        return false
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files
        if (!files) return false
        const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'))
        if (!imgs.length) return false
        for (const f of imgs) void ingestImage(f)
        return true
      },
    },
  })

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // 外部 value 变化（如 AI 起草整体替换）时同步进编辑器
  useEffect(() => {
    if (!editor) return
    if (value !== lastEmitted.current) {
      lastEmitted.current = value
      editor.commands.setContent(value || '')
    }
  }, [value, editor])

  // 润色相关状态
  const [polishOpen, setPolishOpen] = useState(false)
  const [showCustom, setShowCustom] = useState(false)
  const [customInstruction, setCustomInstruction] = useState('')
  const [polishing, setPolishing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  if (!editor) {
    return <div className="min-h-[300px] rounded-md border border-input bg-input" />
  }

  const runPolish = async (action: PolishAction, instruction?: string) => {
    const { from, to, empty } = editor.state.selection
    const text = empty
      ? editor.getText()
      : editor.state.doc.textBetween(from, to, '\n')
    if (!text || !text.trim()) {
      setStatus('没有可润色的文字')
      setPolishOpen(false)
      setShowCustom(false)
      return
    }
    if (text.length > 20000) {
      setStatus('内容过长（>20000 字），请缩小选区')
      return
    }
    setPolishing(true)
    setStatus(null)
    setPolishOpen(false)
    setShowCustom(false)
    try {
      const res = await fetch('/api/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, action, instruction }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '润色失败')
      const html = textToHtml(data.polished || '')
      const cmd = editor.chain().focus()
      if (empty) cmd.setContent(html).run()
      else cmd.deleteSelection().insertContent(html).run()
      setStatus('✨ 已润色（选中区域行内格式已重置为纯文本）')
    } catch (err) {
      setStatus(`❌ ${err instanceof Error ? err.message : '润色失败'}`)
    } finally {
      setPolishing(false)
    }
  }

  return (
    <div className="rounded-md border border-border bg-card">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1">
        <Tool title="撤销" label="↶" onClick={() => editor.chain().focus().undo().run()} />
        <Tool title="重做" label="↷" onClick={() => editor.chain().focus().redo().run()} />
        <span className="mx-1 h-4 w-px bg-border" />

        <Tool title="加粗" label={<b>B</b>} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
        <Tool title="斜体" label={<i>I</i>} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <Tool title="下划线" label={<u>U</u>} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <Tool title="删除线" label={<s>S</s>} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <span className="mx-1 h-4 w-px bg-border" />

        {/* 字号 */}
        <select
          title="字号"
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = e.target.value
            if (v) editor.chain().focus().setFontSize(v).run()
            e.target.value = ''
          }}
          defaultValue=""
          className="h-7 rounded bg-input px-1 text-xs text-foreground outline-none"
        >
          <option value="" disabled>字号</option>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* 文字颜色 */}
        <label title="文字颜色" className="flex h-7 cursor-pointer items-center rounded px-1 hover:bg-accent">
          <span className="text-xs">A</span>
          <input
            type="color"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            className="ml-0.5 h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
          />
        </label>

        {/* 高亮 */}
        <label title="高亮" className="flex h-7 cursor-pointer items-center rounded px-1 hover:bg-accent">
          <span className="text-xs">🖊</span>
          <input
            type="color"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()}
            className="ml-0.5 h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
          />
        </label>
        <span className="mx-1 h-4 w-px bg-border" />

        <Tool title="标题1" label="H1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <Tool title="标题2" label="H2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <Tool title="正文" label="¶" active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()} />
        <span className="mx-1 h-4 w-px bg-border" />

        <Tool title="无序列表" label="• 列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <Tool title="有序列表" label="1. 列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <Tool title="引用" label="❝" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
        <Tool title="代码块" label="{'</>'}" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
        <span className="mx-1 h-4 w-px bg-border" />

        <Tool title="左对齐" label="⬅" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} />
        <Tool title="居中" label="⬌" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} />
        <Tool title="右对齐" label="➡" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} />
        <span className="mx-1 h-4 w-px bg-border" />

        <Tool
          title="链接"
          label="🔗"
          active={editor.isActive('link')}
          onClick={() => {
            const prev = editor.getAttributes('link').href
            const url = window.prompt('链接地址', prev || 'https://')
            if (url === null) return
            if (url === '') editor.chain().focus().unsetLink().run()
            else editor.chain().focus().setLink({ href: url }).run()
          }}
        />
        <Tool
          title="图片（URL）"
          label="🖼"
          onClick={() => {
            const url = window.prompt('图片地址 https://')
            if (url) editor.chain().focus().setImage({ src: url }).run()
          }}
        />
        <Tool title="插入表格" label="▦" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
        <Tool title="清除格式" label="⌫" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} />
        <span className="mx-1 h-4 w-px bg-border" />

        {/* AI 润色 */}
        <div className="relative">
          <button
            type="button"
            title="AI 润色"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setPolishOpen((v) => !v)
              setShowCustom(false)
              setStatus(null)
            }}
            disabled={polishing}
            className="flex h-7 items-center rounded bg-primary px-2 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {polishing ? '⏳ 润色中…' : '✨ 润色'}
          </button>
          {polishOpen && (
            <div className="absolute left-0 top-8 z-20 w-44 rounded-md border border-border bg-popover p-1 shadow-lg">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runPolish('grammar')} className="block w-full rounded px-2 py-1 text-left text-xs text-foreground hover:bg-accent">语法修正</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runPolish('formal')} className="block w-full rounded px-2 py-1 text-left text-xs text-foreground hover:bg-accent">更正式</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runPolish('friendly')} className="block w-full rounded px-2 py-1 text-left text-xs text-foreground hover:bg-accent">更亲切</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runPolish('concise')} className="block w-full rounded px-2 py-1 text-left text-xs text-foreground hover:bg-accent">更简洁</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setShowCustom((v) => !v)} className="block w-full rounded px-2 py-1 text-left text-xs text-foreground hover:bg-accent">自定义…</button>
              {showCustom && (
                <div className="mt-1 flex gap-1 p-1">
                  <input
                    value={customInstruction}
                    onChange={(e) => setCustomInstruction(e.target.value)}
                    placeholder="如：缩短一半"
                    onMouseDown={(e) => e.stopPropagation()}
                    className="w-full rounded border border-border bg-input px-1.5 py-1 text-xs text-foreground outline-none"
                  />
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => customInstruction.trim() && runPolish('custom', customInstruction.trim())} className="rounded bg-primary px-2 text-xs text-primary-foreground">→</button>
                </div>
              )}
              <p className="mt-1 px-2 pb-1 text-[10px] leading-snug text-muted-foreground">润色选区（无选区则整篇）；行内格式会重置为纯文本。</p>
            </div>
          )}
        </div>
      </div>

      {/* 编辑区 */}
      <EditorContent editor={editor} />

      {/* 润色/编辑状态 */}
      {status && (
        <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{status}</div>
      )}
    </div>
  )
}
