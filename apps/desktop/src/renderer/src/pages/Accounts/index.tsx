import { useEffect, useState } from 'react'
import { Plus, Trash2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { useAccountsStore } from '@/store/useAccountsStore'
import type { LoginStatus } from '../../../../shared/types'

/**
 * 账号管理页面
 * @see 文档 2.3.1 账号管理
 * 创建账号 / 启动关闭 Profile / 手动登录 / 检查登录态 / 删除账号
 */

const loginStatusMap: Record<LoginStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  unknown: { label: '未知', variant: 'secondary' },
  'logged-in': { label: '已登录', variant: 'success' },
  'logged-out': { label: '未登录', variant: 'warning' },
  'verification-required': { label: '需要验证', variant: 'destructive' },
  'risk-control': { label: '风控', variant: 'destructive' }
}

function CreateAccountDialog() {
  const createAccount = useAccountsStore((s) => s.createAccount)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim() || !username.trim()) return
    setSubmitting(true)
    const created = await createAccount({ name, taobaoUsername: username, notes })
    setSubmitting(false)
    if (created) {
      setName('')
      setUsername('')
      setNotes('')
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="h-4 w-4" />
        创建账号
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建账号</DialogTitle>
          <DialogDescription>创建后将生成独立的 Chrome Profile 目录</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>账号别名</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：直播主号"
            />
          </div>
          <div className="space-y-2">
            <Label>淘宝用户名</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="淘宝登录账号"
            />
          </div>
          <div className="space-y-2">
            <Label>备注</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="可选"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim() || !username.trim()}>
            {submitting ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteAccountDialog({ accountId, accountName }: { accountId: string; accountName: string }) {
  const deleteAccount = useAccountsStore((s) => s.deleteAccount)
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    const ok = await deleteAccount(accountId)
    setDeleting(false)
    if (ok) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" />}>
        <Trash2 className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除账号</DialogTitle>
          <DialogDescription>
            确认删除账号「{accountName}」？此操作将删除账号配置，如需保留 Chrome 登录态请谨慎操作。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? '删除中...' : '删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function AccountsPage() {
  const { accounts, runtimes, loading, error, load, startBrowser, stopBrowser, startLogin } =
    useAccountsStore()

  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [load])

  const isRunning = (accountId: string) => runtimes[accountId]?.status === 'running'

  const handleStart = async (id: string) => {
    setBusy(id)
    await startBrowser(id)
    setBusy(null)
  }

  const handleStop = async (id: string) => {
    setBusy(id)
    await stopBrowser(id)
    setBusy(null)
  }

  const handleLogin = async (id: string) => {
    setBusy(id)
    await startLogin(id)
    setBusy(null)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">账号管理</h1>
          <p className="text-muted-foreground">管理淘宝直播中控台账号</p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <CreateAccountDialog />
        </div>
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">操作失败：{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>账号列表</CardTitle>
          <CardDescription>
            {loading ? '加载中...' : `共 ${accounts.length} 个账号`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 && !loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              暂无账号，点击右上角「创建账号」开始
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>别名</TableHead>
                  <TableHead>淘宝用户名</TableHead>
                  <TableHead>登录状态</TableHead>
                  <TableHead>浏览器</TableHead>
                  <TableHead>最后登录</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => {
                  const status = loginStatusMap[account.loginStatus] ?? loginStatusMap.unknown
                  const running = isRunning(account.id)
                  const isBusy = busy === account.id
                  return (
                    <TableRow key={account.id}>
                      <TableCell className="font-medium">{account.name}</TableCell>
                      <TableCell>{account.taobaoUsername}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell>
                        {running ? (
                          <Badge variant="success">运行中</Badge>
                        ) : (
                          <Badge variant="secondary">已停止</Badge>
                        )}
                      </TableCell>
                      <TableCell>{account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('zh-CN') : '—'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {running ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleStop(account.id)}
                              disabled={isBusy}
                            >
                              {isBusy ? '处理中...' : '停止'}
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleStart(account.id)}
                              disabled={isBusy}
                            >
                              {isBusy ? '处理中...' : '启动'}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleLogin(account.id)}
                            disabled={isBusy}
                          >
                            {isBusy ? '处理中...' : '登录'}
                          </Button>
                          <DeleteAccountDialog accountId={account.id} accountName={account.name} />
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}