// src/components/EmailInput.tsx

'use client'

import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface EmailInputProps {
  onSubmit: (text: string) => void
  isLoading: boolean
}

export function EmailInput({ onSubmit, isLoading }: EmailInputProps) {
  const [text, setText] = useState('')

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text.trim())
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>📬 粘贴邮件内容</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          placeholder="将邮件正文粘贴到这里..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="font-mono text-sm"
        />
        <Button
          onClick={handleSubmit}
          disabled={!text.trim() || isLoading}
          className="w-full"
        >
          {isLoading ? '🔍 正在分析...' : '🔍 提取待办'}
        </Button>
      </CardContent>
    </Card>
  )
}
