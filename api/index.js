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
    if (method === 'POST' && (urlParts[0] === 'api' && urlParts[1] === 'index')) {
      const { action, groupId, userId, username, requestId } = body;
      
      if (!action || !groupId || !validateUserId(userId)) {
        return sendResponse(res, 400, { 
          error: 'Missing required fields: action, groupId, or valid userId' 
        });
      }

      try {
        switch (action) {
          case 'join':
            const joinResult = await GroupService.joinGroup(userId, username || user.username, groupId);
            
            if (joinResult.status === 'active') {
              // Create system message for successful join
              try {
                const systemMessage = await MessageService.createSystemMessage({
                  groupId,
                  content: `${username || user.username || 'User'} joined the group`,
                  type: 'system'
                });
                
                // Publish member joined event
                EventBus.publish('member.joined', { 
                  userId, 
                  groupId, 
                  username: username || user.username,
                  member: joinResult,
                  systemMessage
                });
              } catch (msgError) {
                console.warn('Failed to create join system message:', msgError);
              }
            } else if (joinResult.status === 'pending') {
              // Publish join request event for admins
              EventBus.publish('join.requested', {
                id: joinResult.requestId,
                userId,
                username: username || user.username,
                groupId,
                requestedAt: new Date().toISOString()
              });
            }
            
            return sendResponse(res, 200, { 
              membership: joinResult, 
              requiresApproval: joinResult.status === 'pending', 
              requestId: joinResult.requestId 
            });

          case 'leave':
            const membership = await GroupService.getMembership(userId, groupId);
            if (!membership) {
              return sendResponse(res, 403, { error: 'Not a member of this group' });
            }

            await GroupService.leaveGroup(userId, groupId);
            
            try {
              // Handle user left in messages
              await MessageService.handleUserLeft(userId, groupId);
              
              // Create system message
              const systemMessage = await MessageService.createSystemMessage({
                groupId,
                content: `${username || user.username || 'User'} left the group`,
                type: 'system'
              });
              
              // Publish member left event
              EventBus.publish('member.left', { 
                userId, 
                groupId, 
                username: username || user.username,
                systemMessage
              });
            } catch (msgError) {
              console.warn('Failed to handle leave messages:', msgError);
            }
            
            return sendResponse(res, 200, { message: 'Successfully left the group' });

          case 'cancelRequest':
            if (!requestId) {
              return sendResponse(res, 400, { error: 'Missing requestId for cancel action' });
            }
            
            await GroupService.cancelJoinRequest(requestId, userId);
            return sendResponse(res, 200, { message: 'Join request cancelled successfully' });

          default:
            return sendResponse(res, 400, { error: `Invalid action: ${action}` });
        }
      } catch (actionError) {
        console.error(`Error in ${action} action:`, actionError);
        return sendResponse(res, 500, { 
          error: `Failed to ${action}: ${actionError.message}`
        });
      }
    }

    // GET /groups/:groupId
    if (method === 'GET' && urlParts[0] === 'groups' && urlParts[1]) {
      const groupId = urlParts[1];
      
      if (!validateUserId(user.userId)) {
        return sendResponse(res, 401, { error: 'Authentication required' });
      }

      try {
        const [group, membership, members] = await Promise.all([
          GroupService.getGroup(groupId),
          GroupService.getMembership(user.userId, groupId),
          GroupService.getGroupMembers(groupId)
        ]);
        
        if (!group) {
          return sendResponse(res, 404, { error: 'Group not found' });
        }

        const permissions = GroupService.getPermissions ? 
          GroupService.getPermissions(membership) : 
          {
            canSendMessages: membership?.status === 'active',
            canDeleteOwnMessages: membership?.status === 'active',
            canDeleteAnyMessage: ['admin', 'moderator'].includes(membership?.role),
            canManageMembers: ['admin', 'moderator'].includes(membership?.role)
          };
        
        return sendResponse(res, 200, { 
          group, 
          membership, 
          permissions,
          members: members || []
        });
      } catch (error) {
        console.error('Error fetching group:', error);
        return sendResponse(res, 500, { error: 'Failed to fetch group details' });
      }
    }

    // GET /groups/:groupId/messages
    if (method === 'GET' && urlParts[0] === 'groups' && urlParts[1] && urlParts[2] === 'messages') {
      const groupId = urlParts[1];
      
      if (!validateUserId(user.userId)) {
        return sendResponse(res, 401, { error: 'Authentication required' });
      }

      try {
        const membership = await GroupService.getMembership(user.userId, groupId);
        if (!membership || membership.status !== 'active') {
          return sendResponse(res, 403, { error: 'Access denied - not an active member' });
        }

        const limit = parseInt(query.limit) || 50;
        const offset = parseInt(query.offset) || 0;
        
        const messages = await MessageService.getMessages(groupId, { limit, offset });
        return sendResponse(res, 200, { messages: messages || [] });
      } catch (error) {
        console.error('Error fetching messages:', error);
        return sendResponse(res, 500, { error: 'Failed to fetch messages' });
      }
    }

    // POST /groups/:groupId/messages
    if (method === 'POST' && urlParts[0] === 'groups' && urlParts[1] && urlParts[2] === 'messages') {
      const groupId = urlParts[1];
      
      if (!validateUserId(user.userId)) {
        return sendResponse(res, 401, { error: 'Authentication required' });
      }

      try {
        const membership = await GroupService.getMembership(user.userId, groupId);
        if (!membership || membership.status !== 'active') {
          return sendResponse(res, 403, { error: 'Cannot send messages - not an active member' });
        }

        const { content, imageUrl } = body;
        if (!content && !imageUrl) {
          return sendResponse(res, 400, { error: 'Message content or image required' });
        }

        const message = await MessageService.createMessage({
          groupId,
          userId: user.userId,
          username: membership.username || user.username,
          content: content || '',
          imageUrl: imageUrl || null
        });

        // Publish message created event
        EventBus.publish('message.created', { message, groupId });
        
        return sendResponse(res, 200, { message });
      } catch (error) {
        console.error('Error creating message:', error);
        return sendResponse(res, 500, { error: 'Failed to create message' });
      }
    }

    // DELETE /groups/:groupId/messages/:messageId
    if (method === 'DELETE' && urlParts[0] === 'groups' && urlParts[1] && urlParts[2] === 'messages' && urlParts[3]) {
      const groupId = urlParts[1];
      const messageId = urlParts[3];
      
      if (!validateUserId(user.userId)) {
        return sendResponse(res, 401, { error: 'Authentication required' });
      }

      try {
        const membership = await GroupService.getMembership(user.userId, groupId);
        if (!membership || membership.status !== 'active') {
          return sendResponse(res, 403, { error: 'Access denied - not a member' });
        }

        const message = await MessageService.getMessage(messageId);
        if (!message || message.group_id !== groupId) {
          return sendResponse(res, 404, { error: 'Message not found' });
        }

        const canDelete = message.user_id === user.userId || 
                         ['admin', 'moderator'].includes(membership.role);
        if (!canDelete) {
          return sendResponse(res, 403, { error: 'Insufficient permissions to delete message' });
        }

        await MessageService.deleteMessage(messageId);
        
        // Publish message deleted event
        EventBus.publish('message.deleted', { groupId, messageId, deletedBy: user.userId });
        
        return sendResponse(res, 200, { message: 'Message deleted successfully' });
      } catch (error) {
        console.error('Error deleting message:', error);
        return sendResponse(res, 500, { error: 'Failed to delete message' });
      }
    }

    // GET /groups/:groupId/requests - Get pending join requests (admin only)
    if (method === 'GET' && urlParts[0] === 'groups' && urlParts[1] && urlParts[2] === 'requests') {
      const groupId = urlParts[1];
      
      if (!validateUserId(user.userId)) {
        return sendResponse(res, 401, { error: 'Authentication required' });
      }

      try {
        const membership = await GroupService.getMembership(user.userId, groupId);
        if (!membership || !['admin', 'moderator'].includes(membership.role)) {
          return sendResponse(res, 403, { error: 'Insufficient permissions' });
        }

        const requests = await GroupService.getGroupJoinRequests(groupId);
        return sendResponse(res, 200, { requests: requests || [] });
      } catch (error) {
        console.error('Error fetching join requests:', error);
        return sendResponse(res, 500, { error: 'Failed to fetch join requests' });
      }
    }

    // POST /groups/:groupId/requests/:requestId/approve
    if (method === 'POST' && urlParts[0] === 'groups' && urlParts[1] && 
        urlParts[2] === 'requests' && urlParts[3] && urlParts[4] === 'approve') {
      const groupId = urlParts[1];
      const requestId = urlParts[3];
      
      if (!validateUserId(user.userId)) {
        return sendResponse(res, 401, { error: 'Authentication required' });
      }

      try {
        const membership = await GroupService.getMembership(user.userId, groupId);
        if (!membership || !['admin', 'moderator'].includes(membership.role)) {
          return sendResponse(res, 403, { error: 'Insufficient permissions' });
        }

        const result = await GroupService.approveJoinRequest(requestId, user.userId);
        
        if (result.newMember) {
          // Create system message
          try {
            const systemMessage = await MessageService.createSystemMessage({
              groupId,
              content: `${result.newMember.username} joined the group`,
              type: 'system'
            });
            
            // Publish member joined event
            EventBus.publish('member.joined', {
              userId: result.newMember.user_id,
              groupId,
              username: result.newMember.username,
              member: result.newMember,
              systemMessage
            });
          } catch (msgError) {
            console.warn('Failed to create approval system message:', msgError);
          }
        }
        
        return sendResponse(res, 200, { 
          message: 'Join request approved',
          newMember: result.newMember 
        });
      } catch (error) {
        console.error('Error approving join request:', error);
        return sendResponse(res, 500, { error: 'Failed to approve join request' });
      }
    }

    // POST /groups/:groupId/requests/:requestId/reject
    if (method === 'POST' && urlParts[0] === 'groups' && urlParts[1] && 
        urlParts[2] === 'requests' && urlParts[3] && urlParts[4] === 'reject') {
      const groupId = urlParts[1];
      const requestId = urlParts[3];
      
      if (!validateUserId(user.userId)) {
        return sendResponse(res, 401, { error: 'Authentication required' });
      }

      try {
        const membership = await GroupService.getMembership(user.userId, groupId);
        if (!membership || !['admin', 'moderator'].includes(membership.role)) {
          return sendResponse(res, 403, { error: 'Insufficient permissions' });
        }

        await GroupService.rejectJoinRequest(requestId, user.userId);
        return sendResponse(res, 200, { message: 'Join request rejected' });
      } catch (error) {
        console.error('Error rejecting join request:', error);
        return sendResponse(res, 500, { error: 'Failed to reject join request' });
      }
    }

    return sendResponse(res, 404, { error: 'Route not found' });

  } catch (error) {
    console.error('API Error:', error);
    return sendResponse(res, 500, { 
      error: 'Internal server error',
      message: error.message
    });
  }
};
