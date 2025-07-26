const mysql = require('../utils/mysql')
const postgres = require('../utils/postgress')

// Services (injected with db connections)
const GroupService = require('../services/GroupService')(mysql)
const MessageService = require('../services/MessageService')(postgres)
const EventBus = require('../services/EventBus')

// CORS
const allowedOrigins = ['https://latestnewsandaffairs.site', 'http://localhost:5173']

const setCorsHeaders = (req, res) => {
  const origin = req.headers.origin
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-ID')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
}

const getUserFromRequest = (req) => {
  const userIdFromHeader = req.headers['x-user-id']
  const userId = req.query?.userId || userIdFromHeader || req.user?.userId
  
  return {
    userId: userId || null,
    username: req.query?.username || req.user?.username || null,
    isAuthenticated: !!userId
  }
}

// Parse JSON body helper
const parseBody = (req) => {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET') {
      resolve({})
      return
    }
    
    let body = ''
    req.on('data', chunk => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(new Error('Invalid JSON'))
      }
    })
  })
}

// Parse query parameters
const parseQuery = (url) => {
  const queryString = url.split('?')[1]
  if (!queryString) return {}
  
  const params = {}
  queryString.split('&').forEach(param => {
    const [key, value] = param.split('=')
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(value || '')
    }
  })
  return params
}

// Main handler
module.exports = async (req, res) => {
  setCorsHeaders(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const url = req.url
  const method = req.method
  
  try {
    // Parse request data
    const query = parseQuery(url)
    const body = await parseBody(req)
    const user = getUserFromRequest({ ...req, query, body })
    
    // Add parsed data to req object
    req.query = query
    req.body = body
    req.user = user

    // ===================
    // GET /api/index - Get groups for user
    // ===================
    if (method === 'GET' && url.startsWith('/api/index')) {
      const userId = query.userId || user.userId
      
      if (!userId) {
        res.statusCode = 400
        return res.end(JSON.stringify({ 
          success: false, 
          error: 'Missing userId parameter' 
        }))
      }

      try {
        // Get all groups and user's memberships
        const [allGroups, userMemberships, pendingRequests] = await Promise.all([
          GroupService.getAllGroups(),
          GroupService.getUserMemberships(userId),
          GroupService.getPendingRequests(userId)
        ])

        // Separate joined and available groups
        const joinedGroups = []
        const availableGroups = []
        
        const memberGroupIds = userMemberships.map(m => m.groupId)
        
        allGroups.forEach(group => {
          if (memberGroupIds.includes(group.id)) {
            const membership = userMemberships.find(m => m.groupId === group.id)
            joinedGroups.push({
              ...group,
              userRole: membership.role,
              joinedAt: membership.joinedAt,
              isMember: true
            })
          } else {
            const pendingRequest = pendingRequests.find(r => r.groupId === group.id)
            availableGroups.push({
              ...group,
              hasPendingRequest: !!pendingRequest,
              membershipStatus: pendingRequest ? 'pending' : 'not_member',
              canCancelRequest: !!pendingRequest,
              requestId: pendingRequest?.id,
              isMember: false
            })
          }
        })

        return res.end(JSON.stringify({
          success: true,
          joinedGroups,
          availableGroups,
          pendingRequests,
          memberships: userMemberships
        }))
      } catch (error) {
        res.statusCode = 500
        return res.end(JSON.stringify({
          success: false,
          error: 'Failed to fetch groups: ' + error.message
        }))
      }
    }

    // ===================
    // POST /api/index - Handle group actions
    // ===================
    if (method === 'POST' && url.startsWith('/api/index')) {
      const { action, groupId, userId, username } = body
      
      if (!action || !groupId || !userId) {
        res.statusCode = 400
        return res.end(JSON.stringify({
          success: false,
          error: 'Missing required parameters: action, groupId, userId'
        }))
      }

      try {
        switch (action) {
          case 'join':
            const joinResult = await GroupService.joinGroup(userId, username || user.username, groupId)
            
            if (joinResult.status === 'active') {
              // Create system message for successful join
              await MessageService.createSystemMessage({
                groupId,
                content: `${username || user.username} joined the group`,
                type: 'system'
              })

              EventBus.publish('member.joined', {
                userId,
                groupId,
                username: username || user.username
              })
            }

            return res.end(JSON.stringify({
              success: true,
              membership: joinResult,
              requiresApproval: joinResult.status === 'pending',
              requestId: joinResult.requestId
            }))

          case 'leave':
            // Check if user is a member
            const membership = await GroupService.getMembership(userId, groupId)
            if (!membership) {
              res.statusCode = 403
              return res.end(JSON.stringify({
                success: false,
                error: 'You are not a member of this group'
              }))
            }

            await GroupService.leaveGroup(userId, groupId)
            await MessageService.handleUserLeft(userId, groupId)
            await MessageService.createSystemMessage({
              groupId,
              content: `${username || user.username} left the group`,
              type: 'system'
            })

            EventBus.publish('member.left', {
              userId,
              groupId,
              username: username || user.username
            })

            return res.end(JSON.stringify({ success: true }))

          case 'cancelRequest':
            const { requestId } = body
            if (!requestId) {
              res.statusCode = 400
              return res.end(JSON.stringify({
                success: false,
                error: 'Missing requestId'
              }))
            }

            await GroupService.cancelJoinRequest(requestId, userId)
            
            return res.end(JSON.stringify({ success: true }))

          default:
            res.statusCode = 400
            return res.end(JSON.stringify({
              success: false,
              error: 'Invalid action. Supported actions: join, leave, cancelRequest'
            }))
        }
      } catch (error) {
        res.statusCode = 500
        return res.end(JSON.stringify({
          success: false,
          error: 'Action failed: ' + error.message
        }))
      }
    }

    // ===================
    // Legacy routes (keep for backward compatibility)
    // ===================
    
    // GET /groups/:groupId
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

    // GET /groups/:groupId/messages
    if (method === 'GET' && url.match(/^\/groups\/\w+\/messages/)) {
      const groupId = url.split('/')[2]
      const membership = await GroupService.getMembership(user.userId, groupId)
      
      if (!membership) {
        res.statusCode = 403
        return res.end(JSON.stringify({ success: false, error: 'Access denied' }))
      }

      const { limit, before } = query
      const messages = await MessageService.getMessages(groupId, { limit, before })
      return res.end(JSON.stringify({ success: true, messages }))
    }

    // POST /groups/:groupId/messages
    if (method === 'POST' && url.match(/^\/groups\/\w+\/messages$/)) {
      const groupId = url.split('/')[2]
      const membership = await GroupService.getMembership(user.userId, groupId)
      
      if (!membership || membership.status !== 'active') {
        res.statusCode = 403
        return res.end(JSON.stringify({ success: false, error: 'Cannot send messages' }))
      }

      const { content, imageUrl } = body
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

    // DELETE /groups/:groupId/messages/:messageId
    if (method === 'DELETE' && url.match(/^\/groups\/\w+\/messages\/\w+$/)) {
      const [, , groupId, , messageId] = url.split('/')
      const membership = await GroupService.getMembership(user.userId, groupId)
      
      if (!membership) {
        res.statusCode = 403
        return res.end(JSON.stringify({ success: false, error: 'Access denied' }))
      }

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
    console.error('API Error:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ success: false, error: err.message }))
  }
}
