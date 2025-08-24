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
  listchatPageSize: number
  useForwardMsg: boolean

}

export const Config: Schema<Config> = Schema.object({
  ' ': Schema.never().description(`
## 这里是 Chat-Archive 插件使用说明：

### 这个插件可以储存群u的精彩发言，并且支持查询/随机发送等操作

（欢迎提 Issue，应该会关注...吧）

### 这里是指令说明

- **savechat**: 引用消息进行存档
- **rollchat**: 随机查看一条存档消息
- **listchat**: 查看存档消息，-p 参数指定页码查找；-s 参数指定特定编号查找
- **delchat**: 删除聊天存档中的单条指定消息
- **resetchat**: 清空单个群聊（--this）/ 所有群聊（--all）的聊天存档

### 插件目前的问题 / TODO：

- **不能合并转发（这个我不会）**

- 在储存图片时，目前直接获取的是qq的临时地址，在一定时间后过期，导致信息无法发送，目前考虑：
    1. 直接删除图片内容   2. 建立本地文件夹   3. 用户手动设置一个图床地址
    
- 增加关键词搜索（编号搜索是个什么玩意）

> [!caution]
> 
> 插件处于“开发中”状态，可能会有意想不到的 bug 产生

  `),
  useGroupNickname: Schema.boolean().default(true).description('savechat时储存消息发送者的名字使用（关：QQ名称 开：群昵称）'),
  savechatAuth: Schema.natural().default(1).description('savechat 指令的权限等级'),
  rollchatAuth: Schema.natural().default(1).description('rollchat 指令的权限等级'),
  useForwardMsg: Schema.boolean().default(false).description(`【尚未实现】rollchat 是否使用合并转发方式输出（关：文本输出 开：转发输出）`),
  delchatAuth: Schema.natural().default(2).description('delchat 指令的权限等级'),
  resetchatAuth: Schema.natural().default(2).description('resetchat 指令的权限等级'),
  listchatAuth: Schema.natural().default(1).description('listchat 指令的权限等级'),
  listchatPageSize: Schema.natural().default(7).description('listchat -p 命令每页显示的记录数量'),

})

// 定义数据库结构的接口
interface msg {
  id: number
  groupId: string
  senderId: string
  senderName: string
  content: string
  timestamp: Date
}

// 为什么我还要单独告诉 Koishi 我新建了一个表单呢 :(
declare module 'koishi' {
  interface Tables {
    chat_archive: msg
  }
}

export function apply(ctx: Context, config: Config) {
  ctx.model.extend('chat_archive', {
    id: 'unsigned',
    groupId: 'string',
    senderId: 'string',
    senderName: 'string',
    content: 'text',
    timestamp: 'timestamp',
  }, {
    autoInc: true,  // 这一条方便 id 自增
  })


  // rollchat 命令
  ctx.command('rollchat')
    .userFields(['authority'])
    .action(async ({ session }) => {
      // 检查权限
      if (session.user.authority < config.rollchatAuth) {
        return '你没有权限执行此操作'
      }

      if (!session?.guildId) {
        return '你知道的，这是群聊指令，为什么要私聊使用呢？'
      }

      const records = await ctx.database.get('chat_archive', { groupId: session.guildId }) 
      if (!records.length) {
        return '当前群聊还没有存储任何的聊天记录'
      }
      const rRecord = records[Math.floor(Math.random() * records.length)]
      const date = rRecord.timestamp
      const formattedDate = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`

      if (config.useForwardMsg) {
        // 使用合并转发方式
        const senderInfo = {
          userId: rRecord.senderId,
          nickname: rRecord.senderName,
        }
        const content = [
          `[${formattedDate}] ${rRecord.senderName}:\n`,
          ...segment.parse(rRecord.content)
        ]
        const forwardNode = segment("message", senderInfo, content)
        return segment("message", { forward: true }, [forwardNode])
      } else {
        // 使用文本方式
        return `[${formattedDate}] ${rRecord.senderName}:\n${rRecord.content}`
      }
    })


  // savechat 命令
  ctx.command('savechat')
    .userFields(['authority'])
    .action(async ({ session }) => {
      // 检查权限
      if (session.user.authority < config.savechatAuth) {
        return '你没有权限执行此操作'
      }

      if (!session?.guildId) {
        return '你知道的，这是群聊指令，为什么要私聊使用呢？'
      }

      if (!session?.quote) {
        return '使用 savechat 指令需要引用对方的消息'
      }

      const quotedMsg = session.quote
      if (!quotedMsg.content) {
        return '无法获取消息内容...?'
      }

      const user = quotedMsg.user
      if (!user) {
        return '无法获取群u信息...?'
      }

      let senderName = user.name || 'unknown'
      if (config.useGroupNickname) {
        const memberInfo = await session.bot.getGuildMember(session.guildId, user.id).catch(() => null)
        if (memberInfo?.nickname) {
          senderName = memberInfo.nickname
        } else if (memberInfo?.user?.name) {
          senderName = memberInfo.user.name
        }
      }

      // 存储到数据库
      const chat_archive = await ctx.database.create('chat_archive', {
        groupId: session.guildId,
        senderId: user.id,
        senderName: senderName,
        content: quotedMsg.content,
        timestamp: new Date(quotedMsg.timestamp || Date.now()),
      })
      // 
      return `#${chat_archive.id} 消息已储存`
    })


  // delchat 命令
  ctx.command('delchat <id:number>')
    .userFields(['authority'])
    .action(async ({ session }, id) => {
      // 检查权限
      if (session.user.authority < config.delchatAuth) {
        return '你没有权限执行此操作'
      }

      if (!session?.guildId) {
        return '你知道的，这是群聊指令，为什么要私聊使用呢？'
      }

      if (!id) {
        return '你需要提供一个整数参数作为需要删除的消息的 id'
      }

      const records = await ctx.database.get('chat_archive', { id, groupId: session.guildId })
      if (!records.length) {
        return `未找到 #${id} 消息记录`
      }

      await ctx.database.remove('chat_archive', { id })
      return `已删除 #${id} 的消息记录`
    })


  // resetchat 命令
  ctx.command('resetchat [option:string]')
    .userFields(['authority'])
    .option('this', '--this 清空当前群聊的数据库')
    .option('all', '--all 清空所有群聊的数据库')
    .action(async ({ session, options }) => {
      // 检查权限
      if (session.user.authority < config.resetchatAuth) {
        return '你没有权限执行此操作'
      }

      if (!session?.guildId) {
        return '你知道的，这是群聊指令，为什么要私聊使用呢？'
      }

      if (!options.this && !options.all) {
        return [
          '参数二选一：', '--this 清空当前群聊聊天信息', '或 --all 清空所有群聊聊天信息'
        ].join('\n')
      }

      if (options.this && options.all) {
        return '不能同时使用 --this 和 --all 参数'
      }

      if (options.this) {
        // 清空当前群聊的数据库
        const result = await ctx.database.remove('chat_archive', { groupId: session.guildId })
        return `已清空当前群聊的 ${result.matched} 条消息记录`
      }

      if (options.all) {
        // 清空所有群聊的数据库
        const result = await ctx.database.remove('chat_archive', {})
        return `已清空所有群聊的 ${result.matched} 条消息记录`
      }

    })


  // listchat 命令
  ctx.command('listchat')
    .userFields(['authority'])
    .option('page', '-p <page:number> 查询指定页码')
    .option('single', '-s <id:number> 查询单个序号的消息')
    .action(async ({ session, options }) => {
      // 检查权限
      if (session.user.authority < config.listchatAuth) {
        return '你没有权限执行此操作'
      }

      if (!session?.guildId) {
        return '你知道的，这是群聊指令，为什么要私聊使用呢？'
      }

      if (!options.page && !options.single) {
        return [
          '参数二选一：',
          '-p <页码> 查询指定页码',
          '-s <序号> 查询单个序号的消息'
        ].join('\n')
      }

      if (options.page && options.single) {
        return '不能同时使用 -p 和 -s 参数'
      }

      const allRecords = await ctx.database.get('chat_archive', { groupId: session.guildId })
      const totalCount = allRecords.length

      if (totalCount === 0) {
        return '当前群聊没有存储任何的聊天记录'
      }

      // 按照时间排序（最新的在顶前面）
      const sRecords = allRecords.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

      if (options.single) {
        // -s：查询单个序号
        const targetId = options.single
        const record = sRecords.find(r => r.id === targetId)

        if (!record) {
          return `没有找到信息 #${targetId} `
        }

        const date = record.timestamp
        const fDate = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`

        return `#${record.id} [${fDate}] ${record.senderName}: ${record.content}`
      }


      if (options.page) {
        // -p：查询页码
        const pageNum = options.page
        if (pageNum < 1) {
          return '页码必须大于0 :('
        }

        const pageSize = config.listchatPageSize
        const totalPages = Math.ceil(totalCount / pageSize)

        if (pageNum > totalPages) {
          return `当前总共只有 ${totalPages} 页聊天记录`
        }

        const offset = (pageNum - 1) * pageSize
        const pageInfo = sRecords.slice(offset, offset + pageSize)

        const output = pageInfo.map(record => {
          const date = record.timestamp
          const fDate = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
          return `#${record.id} [${fDate}] ${record.senderName}: ${record.content}`
        })

        output.unshift(`第 ${pageNum}/${totalPages} 页, 共: ${totalCount} 条记录:`)
        return output.join('\n')
      }
    })
}