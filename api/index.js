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

module.exports = async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const query = parseQuery(req.url);
    const body = await parseBody(req);
    const user = getUserFromRequest({ ...req, query, body });
    const { method, url } = req;

    if (method === 'GET' && url.startsWith('/api/index')) {
      const userId = query.userId || user.userId;
      if (!userId) return sendResponse(res, 400, { error: 'Missing userId parameter' });

      const [allGroups, userMemberships, pendingRequests] = await Promise.all([
        GroupService.getAllGroups(),
        GroupService.getUserMemberships(userId),
        GroupService.getPendingRequests(userId)
      ]);

      const memberGroupIds = userMemberships.map(m => m.groupId);
      const joinedGroups = [], availableGroups = [];

      allGroups.forEach(group => {
        if (memberGroupIds.includes(group.id)) {
          const m = userMemberships.find(m => m.groupId === group.id);
          joinedGroups.push({ ...group, userRole: m.role, joinedAt: m.joinedAt, isMember: true });
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

    if (method === 'POST' && url.startsWith('/api/index')) {
      const { action, groupId, userId, username, requestId } = body;
      if (!action || !groupId || !userId)
        return res.end(JSON.stringify({ success: false, error: 'Missing action, groupId or userId' }));

      switch (action) {
        case 'join':
          const join = await GroupService.joinGroup(userId, username || user.username, groupId);
          if (join.status === 'active') {
            await MessageService.createSystemMessage({
              groupId,
              content: `${username || user.username} joined the group`,
              type: 'system'
            });
            EventBus.publish('member.joined', { userId, groupId, username: username || user.username });
          }
          return res.end(JSON.stringify({ success: true, membership: join, requiresApproval: join.status === 'pending', requestId: join.requestId }));

        case 'leave':
          const membership = await GroupService.getMembership(userId, groupId);
          if (!membership) return res.end(JSON.stringify({ success: false, error: 'Not a member' }));

          await GroupService.leaveGroup(userId, groupId);
          await MessageService.handleUserLeft(userId, groupId);
          await MessageService.createSystemMessage({
            groupId,
            content: `${username || user.username} left the group`,
            type: 'system'
          });
          EventBus.publish('member.left', { userId, groupId, username: username || user.username });
          return res.end(JSON.stringify({ success: true }));

        case 'cancelRequest':
          if (!requestId) return res.end(JSON.stringify({ success: false, error: 'Missing requestId' }));
          await GroupService.cancelJoinRequest(requestId, userId);
          return res.end(JSON.stringify({ success: true }));

        default:
          return res.end(JSON.stringify({ success: false, error: 'Invalid action' }));
      }
    }

    if (method === 'GET' && url.match(/^\/groups\/\w+$/)) {
      const groupId = url.split('/')[2];
      const [group, membership] = await Promise.all([
        GroupService.getGroup(groupId),
        GroupService.getMembership(user.userId, groupId)
      ]);
      return res.end(JSON.stringify({ success: true, group, membership, permissions: GroupService.getPermissions(membership) }));
    }

    if (method === 'GET' && url.match(/^\/groups\/\w+\/messages/)) {
      const groupId = url.split('/')[2];
      const membership = await GroupService.getMembership(user.userId, groupId);
      if (!membership) return res.end(JSON.stringify({ success: false, error: 'Access denied' }));

      const { limit, before } = query;
      const messages = await MessageService.getMessages(groupId, { limit, before });
      return res.end(JSON.stringify({ success: true, messages }));
    }

    if (method === 'POST' && url.match(/^\/groups\/\w+\/messages$/)) {
      const groupId = url.split('/')[2];
      const membership = await GroupService.getMembership(user.userId, groupId);
      if (!membership || membership.status !== 'active') return res.end(JSON.stringify({ success: false, error: 'Cannot send messages' }));

      const { content, imageUrl } = body;
      const message = await MessageService.createMessage({
        groupId,
        userId: user.userId,
        username: membership.username,
        content,
        imageUrl
      });

      EventBus.publish('message.created', { message, groupId });
      return res.end(JSON.stringify({ success: true, message }));
    }

    if (method === 'DELETE' && url.match(/^\/groups\/\w+\/messages\/\w+$/)) {
      const [, , groupId, , messageId] = url.split('/');
      const membership = await GroupService.getMembership(user.userId, groupId);
      if (!membership) return res.end(JSON.stringify({ success: false, error: 'Access denied' }));

      const message = await MessageService.getMessage(messageId);
      if (!message || message.group_id !== groupId) return res.end(JSON.stringify({ success: false, error: 'Message not found' }));

      const canDelete = message.user_id === user.userId || ['admin', 'moderator'].includes(membership.role);
      if (!canDelete) return res.end(JSON.stringify({ success: false, error: 'Insufficient permissions' }));

      await MessageService.deleteMessage(messageId);
      EventBus.publish('message.deleted', { groupId, messageId, deletedBy: user.userId });
      return res.end(JSON.stringify({ success: true }));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, error: 'Route not found' }));
  } catch (err) {
    console.error('API Error:', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
};

