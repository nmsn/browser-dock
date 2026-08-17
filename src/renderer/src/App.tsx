import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function App(): JSX.Element {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.dock?.getVersion?.().then((v: string) => setVersion(v))
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Browser Dock</h1>
        <p className="text-muted-foreground">淘宝直播中控台自动化工具</p>
        {version && (
          <p className="text-sm text-muted-foreground">Version: {version}</p>
        )}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>项目初始化完成</CardTitle>
            <CardDescription>请按照文档添加组件和功能</CardDescription>
          </CardHeader>
          <CardContent>
            <Button>开始使用</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default App
