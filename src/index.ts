import { Context, HTTP, Schema, segment, h } from 'koishi'
import * as fs from 'fs'
import * as path from 'path'

export const name = 'chat-archive'
export const using = ['database']

export interface Config {
  Settings: {
    useGroupNickname: boolean
    useForwardMsg: boolean
    chatPageSize: number
    imageStoragePath: string
  }
  Permissions: {
    savechatAuth: number
    rollchatAuth: number
    delchatAuth: number
    resetchatAuth: number
    listchatAuth: number
    findchatAuth: number
  }
}

export const usage = `
## 这里是 Chat-Archive 插件使用说明：

### 这个插件可以储存群u的发言，并且支持查询/随机发送等操作

（欢迎提 Issue，应该会关注...吧）

### 这里是指令说明

- **savechat**: 引用消息进行存档
  - savechat -t <tag> 或 savechat <tag> 可为消息设置标签
  - 注意：tag不能和被引用的文本完全一致！

- **rollchat**: 随机查看一条存档消息

- **listchat**: 查看存档消息，-p 参数指定页码；-s 参数指定特定编号查找

- **delchat**: 删除聊天存档中的单条指定消息

- **resetchat**: 清空单个群聊（--this）/ 所有群聊（--all）的聊天存档

- **findchat**: 对存档进行关键词查询，多个关键词之间用空格分隔，不区分大小写

  - 语法 findchat <key1> [key2] ...

  - 也可以额外使用 -t 标签对特定标签进行查询，比如 findchat -t <tag> [key1] [key2] ...

### 插件目前处于“开发中”状态，可能会有意想不到的 bug 产生

`

export const Config: Schema<Config> = Schema.object({
  Settings: Schema.object({
    useGroupNickname: Schema.boolean()
      .default(true)
      .description('【尚未实现】savechat时储存消息发送者的名字使用（关：QQ名称 开：群昵称）'),
    useForwardMsg: Schema.boolean()
      .default(false)
      .description('【尚未实现】是否使用合并转发方式输出（关：文本输出 开：转发输出）'),
    chatPageSize: Schema.natural()
      .default(7)
      .description('使用 -p 参数时每页显示的消息数量'),
    // 添加图片存储路径配置
    imageStoragePath: Schema.string()
      .default('./data/chat_archive_images')
      .description(`图片本地化存储路径（相对路径）\n修改其内容不会同步修改已经存储的图片的路径，所以请在使用插件前修改`),
  }).description('功能设置'),

  Permissions: Schema.object({
    savechatAuth: Schema.natural()
      .default(1)
      .description('savechat 指令的权限等级'),
    rollchatAuth: Schema.natural()
      .default(1)
      .description('rollchat 指令的权限等级'),
    delchatAuth: Schema.natural()
      .default(2)
      .description('delchat 指令的权限等级'),
    resetchatAuth: Schema.natural()
      .default(2)
      .description('resetchat 指令的权限等级'),
    listchatAuth: Schema.natural()
      .default(1)
      .description('listchat 指令的权限等级'),
    findchatAuth: Schema.natural()
      .default(1)
      .description('findchat 指令的权限等级'),
  }).description('权限设置'),
})


// 定义数据库结构的接口
interface msg {
  id: number
  tag: string
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


// 权限检查函数
// 我终于知道要把重复使用的指令封装一下了
function checkSth(session: any, _Auth: number): string | null {
  if (session.user.authority < _Auth) {
    return '你没有权限执行此操作'
  }

  if (!session?.guildId) {
    return '你知道的，这是群聊指令，为什么要私聊使用呢？'
  }

  return null
}

// 日期格式化函数，为了可读性把那一坨参数拆开来了，方便知道 isShort 参数的作用
function formatDate(date: Date, isShort: boolean = false): string {
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')

  if (isShort) {
    return `${month}-${day} ${hours}:${minutes}`
  } else {
    const seconds = date.getSeconds().toString().padStart(2, '0')
    const year = date.getFullYear()
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  }
}

// 单条消息输出函数
function fSigMessage(record: msg, useForwardMsg: boolean = false): string | segment {
  const date = record.timestamp
  const fDate = formatDate(date, false)

  if (useForwardMsg) {
    const senderInfo = {
      userId: record.senderId,
      nickname: record.senderName,
    }
    const content = [
      `[${fDate}] ${record.senderName}:\n`,
      ...segment.parse(record.content)
    ]
    const forwardNode = segment("message", senderInfo, content)
    return segment("message", { forward: true }, [forwardNode])
  } else {
    return `[${fDate}] ${record.senderName}:\n${record.content}`
  }
}

// 多条消息输出函数
// TODO: 加上合并转发，在我意识到怎么构造合并转发信息之后（故意加的TODO）
function fMulMessages(records: msg[], pageNum: number, totalPages: number, totalCount: number, useForwardMsg: boolean = false): string {
  const output = records.map(record => {
    const date = record.timestamp
    const fDate = formatDate(date, true)
    return `#${record.id} [${fDate}] ${record.senderName}: \n${record.content}\n`
  })

  output.unshift(`第 ${pageNum}/${totalPages} 页, 共${totalCount}条记录`)
  return output.join('\n')
}


export function apply(ctx: Context, config: Config) {
  ctx.model.extend('chat_archive', {
    id: 'unsigned',
    tag: 'string',
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
      const _check = checkSth(session, config.Permissions.rollchatAuth)
      if (_check) return _check

      const records = await ctx.database.get('chat_archive', { groupId: session.guildId })
      if (!records.length) {
        return '当前群聊还没有存储任何的聊天记录'
      }
      const rRecord = records[Math.floor(Math.random() * records.length)]
      return fSigMessage(rRecord, config.Settings.useForwardMsg) as string
    })


  // savechat 命令
  ctx.command('savechat [tag:string]')
    .userFields(['authority'])
    .option('tag', '-t tag:string 为消息添加标签')
    .action(async ({ session, options }, tag) => {
      const _check = checkSth(session, config.Permissions.savechatAuth)
      if (_check) return _check

      if (!session?.quote) {
        return '使用 savechat 指令需要引用对方的消息'
      }

      const quotedMsg = session.quote
      if (!quotedMsg.content) {
        return '无法获取消息内容...?'
      }

      const user = quotedMsg.user
      if (!user) {
        return '无法获取群用户信息...?'
      }

      let finalTag = ''
      if (typeof options.tag === 'string') {
        finalTag = options.tag
      } else if (typeof tag === 'string') {
        finalTag = tag
      }

      // Tag 不能完全与引用文本一致
      if (finalTag === session.quote?.content) {
        finalTag = '';
      }

      let senderName = user.name || 'Unknown'
      if (config.Settings.useGroupNickname) {
        const memberInfo = await session.bot.getGuildMember(session.guildId, user.id).catch(() => null)
        if (memberInfo?.nickname) {
          senderName = memberInfo.nickname
        } else if (memberInfo?.user?.name) {
          senderName = memberInfo.user.name
        }
      }

      // 提取图片URL
      const extractImageUrls = (content) => {
        const urls = []
        const imgElements = h.select(content, 'img')
        for (const img of imgElements) {
          if (img.attrs.src) {
            urls.push({
              fullMatch: h('img', img.attrs).toString(),
              src: img.attrs.src,
              fileName: img.attrs.file || `image_${Date.now()}`
            })
          }
        }
        return urls
      }

      // 下载图片并保存到本地（使用相对路径）
      const downloadAndSaveImage = async (http, imageUrl, fileName, config) => {
        const fs = require('fs').promises
        const path = require('path')

        // 存储目录（相对路径）
        const storageDir = config?.Settings?.imageStoragePath || 'data/chat_archive_images'
        await fs.mkdir(storageDir, { recursive: true }).catch(() => { })

        // 替换文件名特殊字符为下划线
        let safeFileName = (fileName || 'image_' + Date.now()).replace(/[\\/:*?"<>|]/g, '_')

        try {
          const file = await http.file(imageUrl)
          if (!file || !file.data) {
            throw new Error('无法获取图片数据')
          }

          // 自动识别扩展名
          let extension = '.png'
          if (file.type === 'image/jpeg' || file.mime === 'image/jpeg') {
            extension = '.jpg'
          } else if (file.type === 'image/png' || file.mime === 'image/png') {
            extension = '.png'
          } else if (file.type === 'image/gif' || file.mime === 'image/gif') {
            extension = '.gif'
          } else if (file.type === 'image/webp' || file.mime === 'image/webp') {
            extension = '.webp'
          }

          if (!path.extname(safeFileName)) {
            safeFileName += extension
          }

          const filePath = path.join(storageDir, safeFileName)

          // 处理重名
          let actualFilePath = filePath
          let counter = 1
          while (true) {
            try {
              await fs.access(actualFilePath)
              const ext = path.extname(filePath)
              const name = path.basename(filePath, ext)
              actualFilePath = path.join(storageDir, `${name}(${counter})${ext}`)
              counter++
            } catch {
              break
            }
          }

          // 写入文件
          await fs.writeFile(actualFilePath, Buffer.from(file.data))

          // 返回相对路径（统一用正斜杠）
          return actualFilePath.replace(/\\/g, '/')
        } catch (error) {
          console.error('下载图片失败:', error)
          throw new Error(`无法下载图片: ${imageUrl}`)
        }
      }

      let rawContent = quotedMsg.content
      const imgMatches = extractImageUrls(rawContent)

      // 替换图片路径为相对路径
      if (imgMatches.length > 0) {
        for (const img of imgMatches) {
          try {
            const localPath = await downloadAndSaveImage(
              session.app.http,
              img.src,
              img.fileName,
              config
            )

            rawContent = rawContent.replace(
              img.fullMatch,
              `<img src="${localPath}" file="${path.basename(localPath)}" />`
            )
          } catch (error) {
            console.error(`下载图片失败: ${img.src}，使用原始链接`, error)
          }
        }
      }

      // 存储到数据库
      const chat_archive = await ctx.database.create('chat_archive', {
        tag: finalTag,
        groupId: session.guildId,
        senderId: user.id,
        senderName: senderName,
        content: rawContent,
        timestamp: new Date(quotedMsg.timestamp || Date.now()),
      })

      // 不直接返回这句话是担心存储图片时会将全部内容存进Tag，而图片链接无法解析，导致输出报错
      // ErrorCode 1200
      const text = `#${chat_archive.id} 消息已储存${finalTag ? `，Tag: ${finalTag}` : ''}`

      const oldQuote = session.quote
      session.quote = null

      try {
        await session.send(h.text(text))
      } finally {
        session.quote = oldQuote
      }
    })


  // delchat 命令
  ctx.command('delchat <id:number>')
    .userFields(['authority'])
    .action(async ({ session }, id) => {
      const _check = checkSth(session, config.Permissions.delchatAuth)
      if (_check) return _check

      if (!id) {
        return '你需要提供一个整数参数作为需要删除的消息的 id'
      }

      const records = await ctx.database.get('chat_archive', { id, groupId: session.guildId })
      if (!records.length) {
        return `未找到 #${id} 消息记录`
      }

      await ctx.database.remove('chat_archive', { id })
      return `已删除 #${id} 消息记录`
    })


  // resetchat 命令
  ctx.command('resetchat [option:string]')
    .userFields(['authority'])
    .option('this', '--this 清空当前群聊的数据库')
    .option('all', '--all 清空所有群聊的数据库')
    .action(async ({ session, options }) => {
      const _check = checkSth(session, config.Permissions.resetchatAuth)
      if (_check) return _check

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
    .option('page', '-p <page:number> 翻页')
    .option('single', '-s <id:number> 查询单个序号的消息')
    .action(async ({ session, options }) => {
      const _check = checkSth(session, config.Permissions.listchatAuth)
      if (_check) return _check

      if (!options.page && !options.single) {
        options.page = 1
      }

      if (options.page && options.single) {
        return '不能同时使用 -p 和 -s 参数'
      }

      const allRecords = await ctx.database.get('chat_archive', { groupId: session.guildId })
      const totalCount = allRecords.length

      if (totalCount === 0) {
        return '当前群聊没有存储任何的聊天记录'
      }

      const sRecords = allRecords.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

      if (options.single) {
        const targetId = options.single
        const record = sRecords.find(r => r.id === targetId)

        if (!record) {
          return `没有找到信息 #${targetId} `
        }

        return fSigMessage(record, config.Settings.useForwardMsg) as string
      }

      if (options.page) {
        const pageNum = options.page || 1
        if (pageNum < 1) {
          return '页码必须大于0 :('
        }

        const pageSize = config.Settings.chatPageSize
        const totalPages = Math.ceil(totalCount / pageSize)

        if (pageNum > totalPages) {
          return `当前总共只有 ${totalPages} 页聊天记录`
        }

        const offset = (pageNum - 1) * pageSize
        const pageInfo = sRecords.slice(offset, offset + pageSize)

        return fMulMessages(pageInfo, pageNum, totalPages, totalCount)
      }
    })

  // findchat 命令
  ctx.command('findchat <keywords:text>')
    .userFields(['authority'])
    .option('page', '-p <page:number> 翻页')
    .option('tag', '-t <tag:string> 按标签筛选')
    .action(async ({ session, options }, keywords) => {
      const _check = checkSth(session, config.Permissions.findchatAuth)
      if (_check) return _check

      if (!keywords && !options.tag) {
        return '请输入 findchat <空格> 要搜索的关键词，多个关键词用空格分隔，或使用 -t 按标签搜索'
      }

      const kwList = keywords ? keywords.split(/\s+/).filter(k => k.trim().length > 0) : []

      // 构建查询条件
      const query: any = { groupId: session.guildId }

      // 添加标签筛选条件
      if (options.tag) {
        query.tag = options.tag
      }

      const allRecords = await ctx.database.get('chat_archive', query)

      // 关键词筛选
      const fRecords = kwList.length > 0
        ? allRecords.filter(record => {
          const content = record.content.toLowerCase()
          return kwList.every(keyword => content.includes(keyword.toLowerCase()))
        })
        : allRecords

      const totalCount = fRecords.length

      if (totalCount === 0) {
        if (options.tag) {
          return kwList.length > 0
            ? `没有找到标签为 "${options.tag}" 且包含指定关键词的聊天记录`
            : `没有找到标签为 "${options.tag}" 的聊天记录`
        } else {
          const keywordStr = kwList.map(k => `"${k}"`).join(' 和 ')
          return `没有找到同时包含 ${keywordStr} 的聊天记录`
        }
      }

      const sRecords = fRecords.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

      const pageNum = options.page || 1
      if (pageNum < 1) {
        return '页码必须大于0 :('
      }

      const pageSize = config.Settings.chatPageSize
      const totalPages = Math.ceil(totalCount / pageSize)

      if (pageNum > totalPages) {
        return `当前总共只有 ${totalPages} 页聊天记录`
      }

      const offset = (pageNum - 1) * pageSize
      const pageInfo = sRecords.slice(offset, offset + pageSize)

      return fMulMessages(pageInfo, pageNum, totalPages, totalCount)
    })
}

// 能看到 try-catch 的部分都是 AI-Assisted 