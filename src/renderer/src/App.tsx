import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import AccountsPage from '@/pages/Accounts'
import TasksPage from '@/pages/Tasks'
import ExecutionPage from '@/pages/Execution'
import SettingsPage from '@/pages/Settings'

type PageKey = 'home' | 'accounts' | 'tasks' | 'execution' | 'settings'

const navigation: Array<{ key: PageKey; label: string }> = [
  { key: 'home', label: '首页' },
  { key: 'accounts', label: '账号管理' },
  { key: 'tasks', label: '任务管理' },
  { key: 'execution', label: '执行监控' },
  { key: 'settings', label: '设置' }
]

function HomePage({ version }: { version: string }) {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Browser Dock</h1>
        <p className="text-muted-foreground">淘宝直播中控台自动化工具</p>
        {version && <p className="text-sm text-muted-foreground mt-1">Version: {version}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>项目初始化完成</CardTitle>
          <CardDescription>Phase 1：基础框架已就绪</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-1 text-muted-foreground">
            <li>✅ Electron 43 + electron-vite 5 构建配置</li>
            <li>✅ React 19 + shadcn/ui + Tailwind CSS 4</li>
            <li>✅ SQLite + better-sqlite3 数据层（含 migration）</li>
            <li>✅ @napi-rs/keyring 密钥环封装</li>
            <li>✅ Pino 结构化日志</li>
            <li>✅ Chrome / CDP / Profile 模块骨架</li>
            <li>✅ Cron 调度 + 并发池 + 账号锁</li>
            <li>⏳ Phase 2：自动化引擎</li>
            <li>⏳ Phase 3：定时调度</li>
            <li>⏳ Phase 4：优化完善</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function App(): JSX.Element {
  const [version, setVersion] = useState('')
  const [currentPage, setCurrentPage] = useState<PageKey>('home')

  useEffect(() => {
    window.dock?.getVersion?.().then((v: string) => setVersion(v))
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <aside className="w-48 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-semibold">Browser Dock</h2>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navigation.map((item) => (
            <Button
              key={item.key}
              variant={currentPage === item.key ? 'secondary' : 'ghost'}
              className="w-full justify-start"
              onClick={() => setCurrentPage(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        {currentPage === 'home' && <HomePage version={version} />}
        {currentPage === 'accounts' && <AccountsPage />}
        {currentPage === 'tasks' && <TasksPage />}
        {currentPage === 'execution' && <ExecutionPage />}
        {currentPage === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}

export default App
