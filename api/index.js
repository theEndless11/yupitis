const mysql = require('../utils/mysql')
const postgres = require('../utils/postgress')

// Services (injected with db connections)
const GroupService = require('./services/GroupService')(mysql)
const MessageService = require('./services/MessageService')(postgres)
const EventBus = require('./services/EventBus')

// CORS
const allowedOrigins = ['https://latestnewsandaffairs.site', 'http://localhost:5173']

const setCorsHeaders = (req, res) => {
  const origin = req.headers.origin
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
}

// Middleware-style function
const validateGroupMembership = async (req, res) => {
  const groupId = req.params?.groupId || req.query?.groupId
  const userId = req.user?.userId

  if (!groupId || !userId) {
    res.statusCode = 400
    res.end(JSON.stringify({ success: false, error: 'Missing groupId or userId' }))
    return null
  }

  try {
    const membership = await GroupService.getMembership(userId, groupId)
    return membership
  } catch {
    res.statusCode = 403
    res.end(JSON.stringify({ success: false, error: 'Access denied' }))
    return null
  }
}

// Main handler
module.exports = async (req, res) => {
  setCorsHeaders(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const url = req.url
  const method = req.method
  const user = req.user || { userId: '123', username: 'TestUser' } // mock for now

  try {
    // ===================
    // GET /groups/:groupId
    // ===================
    if (method === 'GET' && url.match(/^\/groups\/\w+$/)) {
      const groupId = url.split('/')[2]
      const [group, membership] = await Promise.all([
        GroupService.getGroup(groupId),
        GroupService.getMembership(user.userId, groupId)
      ])

      return res.end(JSON.stringify({
        success: true,
        group,
        membership,
        permissions: GroupService.getPermissions(membership)
      }))
    }

    // ===================
    // POST /groups/:groupId/join
    // ===================
    if (method === 'POST' && url.match(/^\/groups\/\w+\/join$/)) {
      const groupId = url.split('/')[2]
      const result = await GroupService.joinGroup(user.userId, user.username, groupId)

      if (result.status === 'active') {
        await MessageService.createSystemMessage({
          groupId,
          content: `${user.username} joined the group`,
          type: 'system'
        })

        EventBus.publish('member.joined', {
          userId: user.userId,
          groupId,
          username: user.username
        })
      }

      return res.end(JSON.stringify({ success: true, membership: result }))
    }

    // ===================
    // POST /groups/:groupId/leave
    // ===================
    if (method === 'POST' && url.match(/^\/groups\/\w+\/leave$/)) {
      const groupId = url.split('/')[2]
      const membership = await validateGroupMembership({ ...req, params: { groupId }, user }, res)
      if (!membership) return

      await GroupService.leaveGroup(user.userId, groupId)
      await MessageService.handleUserLeft(user.userId, groupId)
      await MessageService.createSystemMessage({
        groupId,
        content: `${user.username} left the group`,
        type: 'system'
      })

      EventBus.publish('member.left', { userId: user.userId, groupId, username: user.username })

      return res.end(JSON.stringify({ success: true }))
    }

    // ===================
    // GET /groups/:groupId/messages
    // ===================
    if (method === 'GET' && url.match(/^\/groups\/\w+\/messages/)) {
      const groupId = url.split('/')[2]
      const membership = await validateGroupMembership({ ...req, params: { groupId }, user }, res)
      if (!membership) return

      const { limit, before } = req.query || {}
      const messages = await MessageService.getMessages(groupId, { limit, before })
      return res.end(JSON.stringify({ success: true, messages }))
    }

    // ===================
    // POST /groups/:groupId/messages
    // ===================
    if (method === 'POST' && url.match(/^\/groups\/\w+\/messages$/)) {
      const groupId = url.split('/')[2]
      const membership = await validateGroupMembership({ ...req, params: { groupId }, user }, res)
      if (!membership || membership.status !== 'active') {
        res.statusCode = 403
        return res.end(JSON.stringify({ success: false, error: 'Cannot send messages' }))
      }

      const { content, imageUrl } = req.body
      const message = await MessageService.createMessage({
        groupId,
        userId: user.userId,
        username: membership.username,
        content,
        imageUrl
      })

      EventBus.publish('message.created', { message, groupId })
      return res.end(JSON.stringify({ success: true, message }))
    }

    // ===================
    // DELETE /groups/:groupId/messages/:messageId
    // ===================
    if (method === 'DELETE' && url.match(/^\/groups\/\w+\/messages\/\w+$/)) {
      const [, , groupId, , messageId] = url.split('/')
      const membership = await validateGroupMembership({ ...req, params: { groupId }, user }, res)
      if (!membership) return

      const message = await MessageService.getMessage(messageId)
      if (!message || message.group_id !== groupId) {
        res.statusCode = 404
        return res.end(JSON.stringify({ success: false, error: 'Message not found' }))
      }

      const canDelete =
        message.user_id === user.userId ||
        ['admin', 'moderator'].includes(membership.role)

      if (!canDelete) {
        res.statusCode = 403
        return res.end(JSON.stringify({ success: false, error: 'Insufficient permissions' }))
      }

      await MessageService.deleteMessage(messageId)
      EventBus.publish('message.deleted', { groupId, messageId, deletedBy: user.userId })

      return res.end(JSON.stringify({ success: true }))
    }

    // Fallback
    res.statusCode = 404
    res.end(JSON.stringify({ success: false, error: 'Route not found' }))
  } catch (err) {
    res.statusCode = 500
    res.end(JSON.stringify({ success: false, error: err.message }))
  }
}
