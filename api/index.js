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
  
  // Verify services have required methods
  console.log('GroupService methods:', Object.keys(GroupService));
  console.log('MessageService methods:', Object.keys(MessageService));
} catch (error) {
  console.error('Service initialization error:', error);
  throw error; // Prevent API from starting with broken services
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

const validateUserId = (userId) => {
  return userId && typeof userId === 'string' && userId.trim().length > 0;
};

module.exports = async (req, res) => {
  // Add defensive checks for serverless environments
  if (!req || !res) {
    console.error('Invalid request or response object');
    return;
  }
  
  // Ensure headers exist
  req.headers = req.headers || {};
  
  // Set CORS headers immediately
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
    const { method, url } = req;

    console.log(`${method} ${url}`, { userId: user.userId, query, bodyKeys: Object.keys(body) });

    // GET /api/index - Get groups for user
    if (method === 'GET' && url.startsWith('/api/index')) {
      const userId = query.userId || user.userId;
      console.log('GET /api/index - userId:', userId);
      
      if (!validateUserId(userId)) {
        return sendResponse(res, 400, { error: 'Missing or invalid userId parameter' });
      }

      // Check if services are properly initialized
      if (!GroupService || !GroupService.getAllGroups) {
        console.error('GroupService not properly initialized');
        return sendResponse(res, 500, { error: 'GroupService not available' });
      }

      try {
        console.log('Fetching groups data for userId:', userId);
        
        const [allGroups, userMemberships, pendingRequests] = await Promise.all([
          GroupService.getAllGroups(),
          GroupService.getUserMemberships(userId),
          GroupService.getPendingRequests(userId)
        ]);
        
        console.log('Fetched data:', { 
          groupsCount: allGroups?.length || 0, 
          membershipsCount: userMemberships?.length || 0, 
          pendingCount: pendingRequests?.length || 0 
        });

        // Ensure we have arrays
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
              joinedAt: membership?.joinedAt || null, 
              isMember: true 
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

        console.log('Processed groups:', { 
          joinedCount: joinedGroups.length, 
          availableCount: availableGroups.length 
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
          error: 'Database error: ' + serviceError.message,
          details: process.env.NODE_ENV === 'development' ? serviceError.stack : undefined
        });
      }
    }

    // POST /api/index - Handle group actions
    if (method === 'POST' && url.startsWith('/api/index')) {
      const { action, groupId, userId, username, requestId } = body;
      
      if (!action || !groupId || !validateUserId(userId)) {
        return sendResponse(res, 400, { 
          error: 'Missing required fields: action, groupId, or valid userId' 
        });
      }

      console.log(`POST /api/index - Action: ${action}, GroupId: ${groupId}, UserId: ${userId}`);

      try {
        switch (action) {
          case 'join':
            if (!GroupService.joinGroup) {
              return sendResponse(res, 500, { error: 'Join group service not available' });
            }

            const joinResult = await GroupService.joinGroup(userId, username || user.username, groupId);
            
            if (joinResult.status === 'active') {
              // Create system message for successful join
              if (MessageService && MessageService.createSystemMessage) {
                try {
                  await MessageService.createSystemMessage({
                    groupId,
                    content: `${username || user.username || 'User'} joined the group`,
                    type: 'system'
                  });
                } catch (msgError) {
                  console.warn('Failed to create join system message:', msgError);
                }
              }
              
              // Publish event
              if (EventBus && EventBus.publish) {
                EventBus.publish('member.joined', { 
                  userId, 
                  groupId, 
                  username: username || user.username 
                });
              }
            }
            
            return sendResponse(res, 200, { 
              membership: joinResult, 
              requiresApproval: joinResult.status === 'pending', 
              requestId: joinResult.requestId 
            });

          case 'leave':
            if (!GroupService.getMembership || !GroupService.leaveGroup) {
              return sendResponse(res, 500, { error: 'Leave group service not available' });
            }

            const membership = await GroupService.getMembership(userId, groupId);
            if (!membership) {
              return sendResponse(res, 403, { error: 'Not a member of this group' });
            }

            await GroupService.leaveGroup(userId, groupId);
            
            // Handle user left in messages
            if (MessageService && MessageService.handleUserLeft) {
              try {
                await MessageService.handleUserLeft(userId, groupId);
              } catch (msgError) {
                console.warn('Failed to handle user left in messages:', msgError);
              }
            }
            
            // Create system message
            if (MessageService && MessageService.createSystemMessage) {
              try {
                await MessageService.createSystemMessage({
                  groupId,
                  content: `${username || user.username || 'User'} left the group`,
                  type: 'system'
                });
              } catch (msgError) {
                console.warn('Failed to create leave system message:', msgError);
              }
            }
            
            // Publish event
            if (EventBus && EventBus.publish) {
              EventBus.publish('member.left', { 
                userId, 
                groupId, 
                username: username || user.username 
              });
            }
            
            return sendResponse(res, 200, { message: 'Successfully left the group' });

          case 'cancelRequest':
            if (!requestId) {
              return sendResponse(res, 400, { error: 'Missing requestId for cancel action' });
            }
            
            if (!GroupService.cancelJoinRequest) {
              return sendResponse(res, 500, { error: 'Cancel request service not available' });
            }
            
            await GroupService.cancelJoinRequest(requestId, userId);
            return sendResponse(res, 200, { message: 'Join request cancelled successfully' });

          default:
            return sendResponse(res, 400, { error: `Invalid action: ${action}` });
        }
      } catch (actionError) {
        console.error(`Error in ${action} action:`, actionError);
        return sendResponse(res, 500, { 
          error: `Failed to ${action}: ${actionError.message}`,
          details: process.env.NODE_ENV === 'development' ? actionError.stack : undefined
        });
      }
    }

    // GET /groups/:groupId
    if (method === 'GET' && url.match(/^\/groups\/\w+$/)) {
      const groupId = url.split('/')[2];
      
      if (!validateUserId(user.userId)) {
        return sendResponse(res, 401, { error: 'Authentication required' });
      }

      try {
        const [group, membership] = await Promise.all([
          GroupService.getGroup(groupId),
          GroupService.getMembership(user.userId, groupId)
        ]);
        
        return sendResponse(res, 200, { 
          group, 
          membership, 
          permissions: GroupService.getPermissions ? GroupService.getPermissions(membership) : {}
        });
      } catch (error) {
        console.error('Error fetching group:', error);
        return sendResponse(res, 500, { error: 'Failed to fetch group details' });
      }
    }

    // GET /groups/:groupId/messages
    if (method === 'GET' && url.match(/^\/groups\/\w+\/messages/)) {
      const groupId = url.split('/')[2];
      
      if (!validateUserId(user.userId)) {
        return sendResponse(res, 401, { error: 'Authentication required' });
      }

      try {
        const membership = await GroupService.getMembership(user.userId, groupId);
        if (!membership) {
          return sendResponse(res, 403, { error: 'Access denied - not a member' });
        }

        const messages = await MessageService.getMessages(groupId, query);
        return sendResponse(res, 200, { messages });
      } catch (error) {
        console.error('Error fetching messages:', error);
        return sendResponse(res, 500, { error: 'Failed to fetch messages' });
      }
    }

    // POST /groups/:groupId/messages
    if (method === 'POST' && url.match(/^\/groups\/\w+\/messages$/)) {
      const groupId = url.split('/')[2];
      
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
          username: membership.username,
          content,
          imageUrl
        });

        if (EventBus && EventBus.publish) {
          EventBus.publish('message.created', { message, groupId });
        }
        
        return sendResponse(res, 200, { message });
      } catch (error) {
        console.error('Error creating message:', error);
        return sendResponse(res, 500, { error: 'Failed to create message' });
      }
    }

    // DELETE /groups/:groupId/messages/:messageId
    if (method === 'DELETE' && url.match(/^\/groups\/\w+\/messages\/\w+$/)) {
      const [, , groupId, , messageId] = url.split('/');
      
      if (!validateUserId(user.userId)) {
        return sendResponse(res, 401, { error: 'Authentication required' });
      }

      try {
        const membership = await GroupService.getMembership(user.userId, groupId);
        if (!membership) {
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
        
        if (EventBus && EventBus.publish) {
          EventBus.publish('message.deleted', { groupId, messageId, deletedBy: user.userId });
        }
        
        return sendResponse(res, 200, { message: 'Message deleted successfully' });
      } catch (error) {
        console.error('Error deleting message:', error);
        return sendResponse(res, 500, { error: 'Failed to delete message' });
      }
    }

    return sendResponse(res, 404, { error: 'Route not found' });

  } catch (error) {
    console.error('API Error:', error);
    return sendResponse(res, 500, { 
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
