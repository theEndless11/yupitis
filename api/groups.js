import { setCorsHeaders } from '../lib/cors';
import mysql from '../utils/mysql';
import { addMember } from './members';

export default async function handler(req, res) {
  setCorsHeaders(res, req.headers.origin || '*');

  const groupId = parseInt(req.query.id);

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
  if (req.query.id) {
    const groupId = parseInt(req.query.id);
    const [group] = await mysql.query('SELECT * FROM groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    return res.json(group);
  } else {
    const [groups] = await mysql.query('SELECT * FROM groups ORDER BY createdAt DESC');
    return res.json(groups);
  }
}

  if (req.method === 'POST') {
    const { name, description, isPrivate } = req.body;
    const userId = req.headers['x-user-id']; // Assumed from client
    if (!name) return res.status(400).json({ error: 'Name required' });

    const [result] = await mysql.query('INSERT INTO groups (name, description, isPrivate, ownerId) VALUES (?, ?, ?, ?)', [
      name.trim(), description || '', isPrivate || false, userId
    ]);

    const newGroupId = result.insertId;
    await addMember(newGroupId, userId, 'admin');
    return res.status(201).json({ id: newGroupId, name });
  }

  if (req.method === 'PUT') {
    const { name, description, avatar } = req.body;
    await mysql.query('UPDATE groups SET name = ?, description = ?, avatar = ? WHERE id = ?', [
      name, description, avatar, groupId
    ]);
    return res.json({ message: 'Group updated' });
  }

  if (req.method === 'DELETE') {
    await mysql.query('DELETE FROM groups WHERE id = ?', [groupId]);
    return res.json({ message: 'Group deleted' });
  }

  return res.status(405).end();
}
