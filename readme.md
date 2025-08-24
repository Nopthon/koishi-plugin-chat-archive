# koishi-plugin-chat-archive

[![npm](https://img.shields.io/npm/v/koishi-plugin-chat-archive?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-chat-archive) ![Static Badge](https://img.shields.io/badge///UNDER CONSTRUCTION//-8A2BE2)

“留档群u的发言，并在将来发挥作用”

"Archive group menbers' awesome messages, revisiting someday."

---

~~好吧这个插件的初期制作动机就是记录群u的逆天发言的，我摊牌了~~

只是个没有啥实用价值的练手作罢了。

你问我这个插件有什么用？你可以参考 QQ 的精华消息，和那个功能差不多：

```example
[2025-08-21 01:23:45] 	A: 一进群就感觉有人欠我 50 块钱
[2025-08-21 01:23:46] 	Z: [引用 A: 一进群就感觉有人欠我 50 块钱] savechat
[2025-08-21 01:23:46] 	Bot: #1 消息已储存
[2025-08-21 01:23:46] 	Z: [引用 Bot: #1 消息已储存] savechat
[2025-08-21 01:23:46] 	Bot: #2 消息已储存
[2025-08-21 01:23:47] 	A: listchat -p 1
[2025-08-21 01:23:47] 	Bot: 第 1/1 页, 总计: 2 条记录:
						#2 [2025-08-24 01:23] Bot: #1 消息已储存
						#1 [2025-08-24 01:23] A: 一进群就感觉有人欠我 50 块钱
						使用 listchat -p  查看其他页
						使用 listchat -s  查看单条消息
[2025-08-21 01:23:48] 	A: rollchat
[2025-08-21 01:23:48] 	Bot: [2025-08-24 01:23:45] 	A: 
							一进群就感觉有人欠我 50 块钱
```

你问我这个插件有什么独特的功能吗？其实我觉得你可以把这个当成知识库，尤其是在更新了关键词查询之后，毕竟 QQ 精华信息最大的缺点是没有查询系统，而这个插件可以进行查询操作：

```
[2025-06-08 15:03:00] 	A: findchat 衬衫的价格
[2025-06-08 15:03:00] 	Bot: 衬衫的价格为九磅十五便士
```

