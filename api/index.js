const mysql = require('../utils/mysql');
const postgres = require('../utils/postgress');

// Initialize services with error handling
let GroupService, MessageService;
try {
  const GroupServiceFactory = require('../services/GroupService');
  const MessageServiceFactory = require('../services/MessageService');
  
  if (!mysql || !postgres) {
    throw new Error('Database connections not available');
  }
  
  GroupService = GroupServiceFactory(mysql);
  MessageService = MessageServiceFactory(postgres);
  
  if (!GroupService || !MessageService) {
    throw new Error('Failed to create services');
  }
  
  console.log('Services initialized successfully');
} catch (error) {
  console.error('Service initialization error:', error);
  throw error;
}

const EventBus = require('../services/EventBus');

// CORS handling
const allowedOrigins = ['https://latestnewsandaffairs.site', 'http://localhost:5173'];
const setCorsHeaders = (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE, PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-ID');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

const getUserFromRequest = (req) => {
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
    if (req.method === 'GET' || req.method === 'DELETE') {
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

const validateUserId = (userId) => {
  return userId && typeof userId === 'string' && userId.trim().length > 0;
};

const parseUrl = (url) => {
  const parts = url.split('?')[0].split('/').filter(Boolean);
  return parts;
};

module.exports = async (req, res) => {
  if (!req || !res) {
    console.error('Invalid request or response object');
    return;
  }
  
  req.headers = req.headers || {};
  setCorsHeaders(req, res);
  
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  try {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const query = Object.fromEntries(urlObj.searchParams.entries());
    const body = await parseBody(req);
    const user = getUserFromRequest({ ...req, query, body });
    const { method } = req;
    const urlParts = parseUrl(req.url);

    console.log(`${method} ${req.url}`, { 
      userId: user.userId, 
      urlParts, 
      query, 
      bodyKeys: Object.keys(body) 
    });

    // GET /api/index - Get groups for user
    if (method === 'GET' && (urlParts[0] === 'api' && urlParts[1] === 'index')) {
      const userId = query.userId || user.userId;
      
      if (!validateUserId(userId)) {
        return sendResponse(res, 400, { error: 'Missing or invalid userId parameter' });
      }

      try {
        const [allGroups, userMemberships, pendingRequests] = await Promise.all([
          GroupService.getAllGroups(),
          GroupService.getUserMemberships(userId),
          GroupService.getPendingRequests(userId)
        ]);

        const safeGroups = Array.isArray(allGroups) ? allGroups : [];
        const safeMemberships = Array.isArray(userMemberships) ? userMemberships : [];
        const safePendingRequests = Array.isArray(pendingRequests) ? pendingRequests : [];

        const memberGroupIds = safeMemberships.map(m => m.groupId);
        const joinedGroups = [];
        const availableGroups = [];

        safeGroups.forEach(group => {
          if (memberGroupIds.includes(group.id)) {
            const membership = safeMemberships.find(m => m.groupId === group.id);
            joinedGroups.push({ 
              ...group, 
              userRole: membership?.role || 'member', 
              joinedAt: membership?.joined_at || null, 
              isMember: true,
              membershipStatus: 'active'
            });
          } else {
            const pendingRequest = safePendingRequests.find(r => r.groupId === group.id);
            availableGroups.push({
              ...group,
              hasPendingRequest: !!pendingRequest,
              membershipStatus: pendingRequest ? 'pending' : 'not_member',
              canCancelRequest: !!pendingRequest,
              requestId: pendingRequest?.id || null,
              isMember: false
            });
          }
        });

        return sendResponse(res, 200, {
          joinedGroups,
          availableGroups,
          pendingRequests: safePendingRequests,
          memberships: safeMemberships
        });

      } catch (serviceError) {
        console.error('Service error in GET /api/index:', serviceError);
        return sendResponse(res, 500, { 
          error: 'Database error: ' + serviceError.message
        });
      }
    }

    // POST /api/index - Handle group actions
   if (method === 'POST' && urlParts[0] === 'api' && urlParts[1] === 'index') {
  const { action, groupId, userId, username, requestId } = body;
  if (!action || !groupId || !validateUserId(userId)) return sendResponse(res, 400, { error: 'Missing required fields' });

  try {
    const uname = username || user.username;

    if (action === 'join') {
      const joinResult = await GroupService.joinGroup(userId, uname, groupId);

      if (joinResult.status === 'active') {
        const msg = await MessageService.createSystemMessage({ groupId, content: `${uname} joined the group`, type: 'system' });
        EventBus.publish('member.joined', { userId, groupId, username: uname, member: joinResult, systemMessage: msg });
      }

      if (joinResult.status === 'pending') {
        EventBus.publish('join.requested', {
          id: joinResult.requestId,
          userId,
          username: uname,
          groupId,
          requestedAt: new Date().toISOString()
        });
      }

      return sendResponse(res, 200, {
        membership: joinResult,
        requiresApproval: joinResult.status === 'pending',
        requestId: joinResult.requestId
      });
    }

    if (action === 'leave') {
      const member = await GroupService.getMembership(userId, groupId);
      if (!member) return sendResponse(res, 403, { error: 'Not a member' });

      await GroupService.leaveGroup(userId, groupId);
      const msg = await MessageService.createSystemMessage({ groupId, content: `${uname} left the group`, type: 'system' });
      await MessageService.handleUserLeft(userId, groupId);
      EventBus.publish('member.left', { userId, groupId, username: uname, systemMessage: msg });

      return sendResponse(res, 200, { message: 'Left group' });
    }

    if (action === 'cancelRequest' && requestId) {
      await GroupService.cancelJoinRequest(requestId, userId);
      return sendResponse(res, 200, { message: 'Cancelled join request' });
    }

    return sendResponse(res, 400, { error: 'Invalid action or missing requestId' });
  } catch (e) {
    return sendResponse(res, 500, { error: `Failed to ${body.action}`, message: e.message });
  }
}

if (method === 'GET' && urlParts[0] === 'groups' && urlParts[1]) {
  const groupId = urlParts[1];
  if (!validateUserId(user.userId)) return sendResponse(res, 401, { error: 'Auth required' });

  try {
    const [group, membership, members] = await Promise.all([
      GroupService.getGroup(groupId),
      GroupService.getMembership(user.userId, groupId),
      GroupService.getGroupMembers(groupId)
    ]);
    if (!group) return sendResponse(res, 404, { error: 'Group not found' });

    const role = membership?.role;
    const perms = GroupService.getPermissions?.(membership) || {
      canSendMessages: membership?.status === 'active',
      canDeleteOwnMessages: membership?.status === 'active',
      canDeleteAnyMessage: ['admin', 'moderator'].includes(role),
      canManageMembers: ['admin', 'moderator'].includes(role)
    };

    return sendResponse(res, 200, { group, membership, permissions: perms, members });
  } catch {
    return sendResponse(res, 500, { error: 'Failed to fetch group' });
  }
}

if (method === 'GET' && urlParts[0] === 'groups' && urlParts[2] === 'messages') {
  const groupId = urlParts[1];
  if (!validateUserId(user.userId)) return sendResponse(res, 401, { error: 'Auth required' });

  try {
    const membership = await GroupService.getMembership(user.userId, groupId);
    if (!membership || membership.status !== 'active') return sendResponse(res, 403, { error: 'Not a member' });

    const messages = await MessageService.getMessages(groupId, {
      limit: parseInt(query.limit) || 50,
      offset: parseInt(query.offset) || 0
    });

    return sendResponse(res, 200, { messages });
  } catch {
    return sendResponse(res, 500, { error: 'Failed to fetch messages' });
  }
}

if (method === 'POST' && urlParts[0] === 'groups' && urlParts[2] === 'messages') {
  const groupId = urlParts[1];
  if (!validateUserId(user.userId)) return sendResponse(res, 401, { error: 'Auth required' });

  try {
    const membership = await GroupService.getMembership(user.userId, groupId);
    if (!membership || membership.status !== 'active') return sendResponse(res, 403, { error: 'Not a member' });

    const { content, imageUrl } = body;
    if (!content && !imageUrl) return sendResponse(res, 400, { error: 'Content or image required' });

    const msg = await MessageService.createMessage({
      groupId,
      userId: user.userId,
      username: membership.username || user.username,
      content: content || '',
      imageUrl: imageUrl || null
    });

    EventBus.publish('message.created', { message: msg, groupId });
    return sendResponse(res, 200, { message: msg });
  } catch {
    return sendResponse(res, 500, { error: 'Failed to create message' });
  }
}

if (method === 'DELETE' && urlParts[0] === 'groups' && urlParts[2] === 'messages' && urlParts[3]) {
  const [groupId, messageId] = [urlParts[1], urlParts[3]];
  if (!validateUserId(user.userId)) return sendResponse(res, 401, { error: 'Auth required' });

  try {
    const member = await GroupService.getMembership(user.userId, groupId);
    if (!member || member.status !== 'active') return sendResponse(res, 403, { error: 'Not a member' });

    const msg = await MessageService.getMessage(messageId);
    if (!msg || msg.group_id !== groupId) return sendResponse(res, 404, { error: 'Message not found' });

    const canDelete = msg.user_id === user.userId || ['admin', 'moderator'].includes(member.role);
    if (!canDelete) return sendResponse(res, 403, { error: 'No permission' });

    await MessageService.deleteMessage(messageId);
    EventBus.publish('message.deleted', { groupId, messageId, deletedBy: user.userId });
    return sendResponse(res, 200, { message: 'Deleted' });
  } catch {
    return sendResponse(res, 500, { error: 'Delete failed' });
  }
}

if (method === 'GET' && urlParts[0] === 'groups' && urlParts[2] === 'requests') {
  const groupId = urlParts[1];
  if (!validateUserId(user.userId)) return sendResponse(res, 401, { error: 'Auth required' });

  try {
    const member = await GroupService.getMembership(user.userId, groupId);
    if (!['admin', 'moderator'].includes(member?.role)) return sendResponse(res, 403, { error: 'Forbidden' });

    const requests = await GroupService.getGroupJoinRequests(groupId);
    return sendResponse(res, 200, { requests });
  } catch {
    return sendResponse(res, 500, { error: 'Request fetch failed' });
  }
}

if (method === 'POST' && urlParts[0] === 'groups' && urlParts[2] === 'requests' && urlParts[4]) {
  const [groupId, requestId, action] = [urlParts[1], urlParts[3], urlParts[4]];
  if (!validateUserId(user.userId)) return sendResponse(res, 401, { error: 'Auth required' });

  try {
    const member = await GroupService.getMembership(user.userId, groupId);
    if (!['admin', 'moderator'].includes(member?.role)) return sendResponse(res, 403, { error: 'Forbidden' });

    if (action === 'approve') {
      const result = await GroupService.approveJoinRequest(requestId, user.userId);
      if (result.newMember) {
        const msg = await MessageService.createSystemMessage({
          groupId,
          content: `${result.newMember.username} joined the group`,
          type: 'system'
        });
        EventBus.publish('member.joined', {
          userId: result.newMember.user_id,
          groupId,
          username: result.newMember.username,
          member: result.newMember,
          systemMessage: msg
        });
      }
      return sendResponse(res, 200, { message: 'Approved', newMember: result.newMember });
    }

    if (action === 'reject') {
      await GroupService.rejectJoinRequest(requestId, user.userId);
      return sendResponse(res, 200, { message: 'Rejected' });
    }

    return sendResponse(res, 400, { error: 'Invalid action' });
  } catch {
    return sendResponse(res, 500, { error: 'Action failed' });
  }
}

return sendResponse(res, 404, { error: 'Route not found' });
