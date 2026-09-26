import { useState, useEffect } from 'react'
import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import AccountsPage from '@/pages/Accounts'
import TasksPage from '@/pages/Tasks'
import SchedulesPage from '@/pages/Schedules'
import ExecutionPage from '@/pages/Execution'
import SettingsPage from '@/pages/Settings'

type PageKey = 'home' | 'accounts' | 'tasks' | 'schedules' | 'execution' | 'settings'

const navigation: Array<{ key: PageKey; label: string }> = [
  { key: 'home', label: '首页' },
  { key: 'accounts', label: '账号管理' },
  { key: 'tasks', label: '任务管理' },
  { key: 'schedules', label: '调度管理' },
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
          <CardTitle>项目进度</CardTitle>
          <CardDescription>Phase 2：自动化引擎</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-1 text-muted-foreground">
            <li>✅ Electron 43 + electron-vite 5 构建配置</li>
            <li>✅ React 19 + shadcn/ui + Tailwind CSS 4</li>
            <li>✅ SQLite + better-sqlite3 数据层（含 migration + 备份）</li>
            <li>✅ 账号管理（CRUD + 浏览器启动/停止 + 登录流程）</li>
            <li>✅ 任务管理（CRUD + 版本追踪）</li>
            <li>✅ 调度管理（Cron + 并发 + 账号选择）</li>
            <li>✅ Chrome / CDP / Automation Context 适配层</li>
            <li>✅ 基础操作封装（点击/输入/导航/截图/等待）</li>
            <li>⏳ Phase 3：定时调度执行引擎（任务执行器串联）</li>
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
        {currentPage === 'schedules' && <SchedulesPage />}
        {currentPage === 'execution' && <ExecutionPage />}
        {currentPage === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}

export default App
