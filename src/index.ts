import { Context, Schema, segment } from 'koishi'

export const name = 'chat-archive'
export const using = ['database']

export interface Config {
  useGroupNickname: boolean
  savechatAuth: number
  rollchatAuth: number
  delchatAuth: number
  resetchatAuth: number
  listchatAuth: number
  findchatAuth: number
  chatPageSize: number
  useForwardMsg: boolean
}

export const Config: Schema<Config> = Schema.object({
  ' ': Schema.never().description(`
## 这里是 Chat-Archive 插件使用说明：

### 这个插件可以储存群u的发言，并且支持查询/随机发送等操作

（欢迎提 Issue，应该会关注...吧）

### 这里是指令说明

- **savechat**: 引用消息进行存档
- **rollchat**: 随机查看一条存档消息
- **listchat**: 查看存档消息，-p 参数指定页码查找；-s 参数指定特定编号查找
- **delchat**: 删除聊天存档中的单条指定消息
- **resetchat**: 清空单个群聊（--this）/ 所有群聊（--all）的聊天存档
- **findchat**: 对存档进行关键词查询，多个关键词之间用空格分隔，不区分大小写

### 插件目前处于“开发中”状态，可能会有意想不到的 bug 产生


  `),
  useGroupNickname: Schema.boolean().default(true).description('savechat时储存消息发送者的名字使用（关：QQ名称 开：群昵称）'),
  savechatAuth: Schema.natural().default(1).description('savechat 指令的权限等级'),
  rollchatAuth: Schema.natural().default(1).description('rollchat 指令的权限等级'),
  useForwardMsg: Schema.boolean().default(false).description(`【尚未实现】是否使用合并转发方式输出（关：文本输出 开：转发输出）`),
  delchatAuth: Schema.natural().default(2).description('delchat 指令的权限等级'),
  resetchatAuth: Schema.natural().default(2).description('resetchat 指令的权限等级'),
  listchatAuth: Schema.natural().default(1).description('listchat 指令的权限等级'),
  findchatAuth: Schema.natural().default(1).description('findchat 指令的权限等级'),
  chatPageSize: Schema.natural().default(7).description('-p 参数每页显示的消息数量'),
})

interface msg {
  id: number
  groupId: string
  senderId: string
  senderName: string
  content: string
  timestamp: Date
}

declare module 'koishi' {
  interface Tables {
    chat_archive: msg
  }
}

function checkSth(session: any, auth: number): string | null {
  if (session.user.authority < auth) return '你没有权限执行此操作'
  if (!session?.guildId) return '你知道的，这是群聊指令，为什么要私聊使用呢？'
  return null
}

function formatDate(date: Date, isShort = false): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())

  return isShort ? `${month}-${day} ${hours}:${minutes}` : `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function formatMessage(record: msg, useForwardMsg = false): string | segment {
  const dateStr = formatDate(record.timestamp, false)

  if (useForwardMsg) {
    return segment("message", { forward: true }, [
      segment("message", {
        userId: record.senderId,
        nickname: record.senderName
      }, [
        `[${dateStr}] ${record.senderName}:\n`,
        ...segment.parse(record.content)
      ])
    ])
  }

  return `[${dateStr}] ${record.senderName}:\n${record.content}`
}

function formatMessages(records: msg[], pageNum: number, totalPages: number, totalCount: number): string {
  const messages = records.map(record => {
    const dateStr = formatDate(record.timestamp, true)
    return `#${record.id} [${dateStr}] ${record.senderName}: \n${record.content}\n`
  })

  return [`第 ${pageNum}/${totalPages} 页, 共${totalCount}条记录`, ...messages].join('\n')
}

export function apply(ctx: Context, config: Config) {
  ctx.model.extend('chat_archive', {
    id: 'unsigned',
    groupId: 'string',
    senderId: 'string',
    senderName: 'string',
    content: 'text',
    timestamp: 'timestamp',
  }, { autoInc: true })

  ctx.command('rollchat')
    .userFields(['authority'])
    .action(async ({ session }) => {
      const check = checkSth(session, config.rollchatAuth)
      if (check) return check

      const records = await ctx.database.get('chat_archive', { groupId: session.guildId })
      if (!records.length) return '当前群聊还没有存储任何的聊天记录'

      const randomRecord = records[Math.floor(Math.random() * records.length)]
      return formatMessage(randomRecord, config.useForwardMsg) as string
    })

  ctx.command('savechat')
    .userFields(['authority'])
    .action(async ({ session }) => {
      const check = checkSth(session, config.savechatAuth)
      if (check) return check
      if (!session?.quote) return '使用 savechat 指令需要引用对方的消息'

      const quotedMsg = session.quote
      if (!quotedMsg.content) return '无法获取消息内容...?'
      if (!quotedMsg.user) return '无法获取群u信息...?'

      const user = quotedMsg.user
      let senderName = user.name || 'unknown'

      if (config.useGroupNickname) {
        const memberInfo = await session.bot.getGuildMember(session.guildId, user.id).catch(() => null)
        if (memberInfo?.nickname) senderName = memberInfo.nickname
        else if (memberInfo?.user?.name) senderName = memberInfo.user.name
      }

      const chatArchive = await ctx.database.create('chat_archive', {
        groupId: session.guildId,
        senderId: user.id,
        senderName,
        content: quotedMsg.content,
        timestamp: new Date(quotedMsg.timestamp || Date.now()),
      })

      return `#${chatArchive.id} 消息已储存`
    })

  ctx.command('delchat <id:number>')
    .userFields(['authority'])
    .action(async ({ session }, id) => {
      const check = checkSth(session, config.delchatAuth)
      if (check) return check
      if (!id) return '你需要提供一个整数参数作为需要删除的消息的 id'

      const records = await ctx.database.get('chat_archive', { id, groupId: session.guildId })
      if (!records.length) return `未找到 #${id} 消息记录`

      await ctx.database.remove('chat_archive', { id })
      return `已删除 #${id} 消息记录`
    })

  ctx.command('resetchat [option:string]')
    .userFields(['authority'])
    .option('this', '--this 清空当前群聊的数据库')
    .option('all', '--all 清空所有群聊的数据库')
    .action(async ({ session, options }) => {
      const check = checkSth(session, config.resetchatAuth)
      if (check) return check

      if (!options.this && !options.all)
        return '参数二选一：\n--this 清空当前群聊聊天信息\n或 --all 清空所有群聊聊天信息'

      if (options.this && options.all) return '不能同时使用 --this 和 --all 参数'

      let result
      if (options.this) {
        result = await ctx.database.remove('chat_archive', { groupId: session.guildId })
        return `已清空当前群聊的 ${result.matched} 条消息记录`
      }

      result = await ctx.database.remove('chat_archive', {})
      return `已清空所有群聊的 ${result.matched} 条消息记录`
    })

  ctx.command('listchat')
    .userFields(['authority'])
    .option('page', '-p <page:number> 查询指定页码')
    .option('single', '-s <id:number> 查询单个序号的消息')
    .action(async ({ session, options }) => {
      const check = checkSth(session, config.listchatAuth)
      if (check) return check

      if (!options.page && !options.single)
        return '参数二选一：\n-p <页码> 查询指定页码\n-s <序号> 查询单个序号的消息'

      if (options.page && options.single) return '不能同时使用 -p 和 -s 参数'

      const allRecords = await ctx.database.get('chat_archive', { groupId: session.guildId })
      if (!allRecords.length) return '当前群聊没有存储任何的聊天记录'

      const sortedRecords = allRecords.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

      if (options.single) {
        const record = sortedRecords.find(r => r.id === options.single)
        return record ? formatMessage(record, config.useForwardMsg) as string : `没有找到信息 #${options.single}`
      }

      const pageNum = options.page || 1
      if (pageNum < 1) return '页码必须大于0 :('

      const pageSize = config.chatPageSize
      const totalPages = Math.ceil(allRecords.length / pageSize)
      if (pageNum > totalPages) return `当前总共只有 ${totalPages} 页聊天记录`

      const offset = (pageNum - 1) * pageSize
      const pageRecords = sortedRecords.slice(offset, offset + pageSize)

      return formatMessages(pageRecords, pageNum, totalPages, allRecords.length)
    })

  ctx.command('findchat <keywords:text>')
    .userFields(['authority'])
    .option('page', '-p <page:number> 查询指定页码')
    .action(async ({ session, options }, keywords) => {
      const check = checkSth(session, config.findchatAuth)
      if (check) return check
      if (!keywords) return '请输入 findchat <空格> 要搜索的关键词，多个关键词用空格分隔'

      const kwList = keywords.split(/\s+/).filter(k => k.trim())
      if (!kwList.length) return '不知道你输入了什么 :('

      const allRecords = await ctx.database.get('chat_archive', { groupId: session.guildId })
      const filteredRecords = allRecords.filter(record =>
        kwList.every(keyword => record.content.toLowerCase().includes(keyword.toLowerCase()))
      )

      if (!filteredRecords.length)
        return `没有找到同时包含 ${kwList.map(k => `"${k}"`).join(' 和 ')} 的聊天记录`

      const sortedRecords = filteredRecords.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      const pageNum = options.page || 1
      if (pageNum < 1) return '页码必须大于0 :('

      const pageSize = config.chatPageSize
      const totalPages = Math.ceil(filteredRecords.length / pageSize)
      if (pageNum > totalPages) return `当前总共只有 ${totalPages} 页聊天记录`

      const offset = (pageNum - 1) * pageSize
      const pageRecords = sortedRecords.slice(offset, offset + pageSize)

      return formatMessages(pageRecords, pageNum, totalPages, filteredRecords.length)
    })
}
