const mysql = require('../utils/mysql');
const postgres = require('../utils/postgress');
const GroupService = require('../services/GroupService')(mysql);
const MessageService = require('../services/MessageService')(postgres);
const EventBus = require('../services/EventBus');

// CORS handling
const allowedOrigins = ['https://latestnewsandaffairs.site', 'http://localhost:5173'];
const setCorsHeaders = (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-ID');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

const getUserFromRequest = (req) => {
  // Handle different request structures (serverless vs regular)
  const headers = req.headers || {};
  const query = req.query || {};
  const body = req.body || {};
  const user = req.user || {};
  
  const userIdFromHeader = headers['x-user-id'];
  const userId = query.userId || userIdFromHeader || user.userId;
  
  return {
    userId: userId || null,
    username: query.username || user.username || null
  };
};

const parseBody = (req) => {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET') {
      resolve({});
      return;
    }
    
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
};

const sendResponse = (res, statusCode, data) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    success: statusCode < 400,
    ...data
  }));
};

module.exports = async (req, res) => {
  // Add defensive checks for serverless environments
  if (!req || !res) {
    console.error('Invalid request or response object');
    return;
  }
  
  // Ensure headers exist
  req.headers = req.headers || {};
  
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const query = Object.fromEntries(urlObj.searchParams.entries());
    const body = await parseBody(req);
    const user = getUserFromRequest({ ...req, query, body });
    const { method, url } = req;

    // GET /api/index - Get groups for user
    if (method === 'GET' && url.startsWith('/api/index')) {
      const userId = query.userId || user.userId;
      console.log('GET /api/index - userId:', userId);
      if (!userId) return sendResponse(res, 400, { error: 'Missing userId parameter' });

      try {
        const [allGroups, userMemberships, pendingRequests] = await Promise.all([
          GroupService.getAllGroups(),
          GroupService.getUserMemberships(userId),
          GroupService.getPendingRequests(userId)
        ]);
        console.log('Fetched data:', { 
          groupsCount: allGroups.length, 
          membershipsCount: userMemberships.length, 
          pendingCount: pendingRequests.length 
        });
      } catch (serviceError) {
        console.error('Service error:', serviceError);
        return sendResponse(res, 500, { error: 'Database error: ' + serviceError.message });
      }

      const memberGroupIds = userMemberships.map(m => m.groupId);
      const joinedGroups = [], availableGroups = [];

      allGroups.forEach(group => {
        if (memberGroupIds.includes(group.id)) {
          const m = userMemberships.find(m => m.groupId === group.id);
          joinedGroups.push({ 
            ...group, 
            userRole: m.role, 
            joinedAt: m.joinedAt, 
            isMember: true 
          });
        } else {
          const pending = pendingRequests.find(r => r.groupId === group.id);
          availableGroups.push({
            ...group,
            hasPendingRequest: !!pending,
            membershipStatus: pending ? 'pending' : 'not_member',
            canCancelRequest: !!pending,
            requestId: pending?.id,
            isMember: false
          });
        }
      });

      return sendResponse(res, 200, {
        joinedGroups,
        availableGroups,
        pendingRequests,
        memberships: userMemberships
      });
    }

    // POST /api/index - Handle group actions
    if (method === 'POST' && url.startsWith('/api/index')) {
      const { action, groupId, userId, username, requestId } = body;
      if (!action || !groupId || !userId) {
        return sendResponse(res, 400, { error: 'Missing action, groupId or userId' });
      }

      switch (action) {
        case 'join':
          const join = await GroupService.joinGroup(userId, username || user.username, groupId);
          if (join.status === 'active') {
            await MessageService.createSystemMessage({
              groupId,
              content: `${username || user.username} joined the group`,
              type: 'system'
            });
            EventBus.publish('member.joined', { 
              userId, 
              groupId, 
              username: username || user.username 
            });
          }
          return sendResponse(res, 200, { 
            membership: join, 
            requiresApproval: join.status === 'pending', 
            requestId: join.requestId 
          });

        case 'leave':
          const membership = await GroupService.getMembership(userId, groupId);
          if (!membership) {
            return sendResponse(res, 403, { error: 'Not a member of this group' });
          }

          await GroupService.leaveGroup(userId, groupId);
          await MessageService.handleUserLeft(userId, groupId);
          await MessageService.createSystemMessage({
            groupId,
            content: `${username || user.username} left the group`,
            type: 'system'
          });
          EventBus.publish('member.left', { 
            userId, 
            groupId, 
            username: username || user.username 
          });
          return sendResponse(res, 200, {});

        case 'cancelRequest':
          if (!requestId) {
            return sendResponse(res, 400, { error: 'Missing requestId' });
          }
          await GroupService.cancelJoinRequest(requestId, userId);
          return sendResponse(res, 200, {});

        default:
          return sendResponse(res, 400, { error: 'Invalid action' });
      }
    }

    // GET /groups/:groupId
    if (method === 'GET' && url.match(/^\/groups\/\w+$/)) {
      const groupId = url.split('/')[2];
      const [group, membership] = await Promise.all([
        GroupService.getGroup(groupId),
        GroupService.getMembership(user.userId, groupId)
      ]);
      return sendResponse(res, 200, { 
        group, 
        membership, 
        permissions: GroupService.getPermissions(membership) 
      });
    }

    // GET /groups/:groupId/messages
    if (method === 'GET' && url.match(/^\/groups\/\w+\/messages/)) {
      const groupId = url.split('/')[2];
      const membership = await GroupService.getMembership(user.userId, groupId);
      if (!membership) {
        return sendResponse(res, 403, { error: 'Access denied' });
      }

      const messages = await MessageService.getMessages(groupId, query);
      return sendResponse(res, 200, { messages });
    }

    // POST /groups/:groupId/messages
    if (method === 'POST' && url.match(/^\/groups\/\w+\/messages$/)) {
      const groupId = url.split('/')[2];
      const membership = await GroupService.getMembership(user.userId, groupId);
      if (!membership || membership.status !== 'active') {
        return sendResponse(res, 403, { error: 'Cannot send messages' });
      }

      const { content, imageUrl } = body;
      const message = await MessageService.createMessage({
        groupId,
        userId: user.userId,
        username: membership.username,
        content,
        imageUrl
      });

      EventBus.publish('message.created', { message, groupId });
      return sendResponse(res, 200, { message });
    }

    // DELETE /groups/:groupId/messages/:messageId
    if (method === 'DELETE' && url.match(/^\/groups\/\w+\/messages\/\w+$/)) {
      const [, , groupId, , messageId] = url.split('/');
      const membership = await GroupService.getMembership(user.userId, groupId);
      if (!membership) {
        return sendResponse(res, 403, { error: 'Access denied' });
      }

      const message = await MessageService.getMessage(messageId);
      if (!message || message.group_id !== groupId) {
        return sendResponse(res, 404, { error: 'Message not found' });
      }

      const canDelete = message.user_id === user.userId || 
                       ['admin', 'moderator'].includes(membership.role);
      if (!canDelete) {
        return sendResponse(res, 403, { error: 'Insufficient permissions' });
      }

      await MessageService.deleteMessage(messageId);
      EventBus.publish('message.deleted', { groupId, messageId, deletedBy: user.userId });
      return sendResponse(res, 200, {});
    }

    return sendResponse(res, 404, { error: 'Route not found' });

  } catch (error) {
    console.error('API Error:', error);
    return sendResponse(res, 500, { error: error.message });
  }
};
