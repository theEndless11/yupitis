export const setCorsHeaders = (res, origin = '*') => {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 
    'Content-Type, Authorization, x-user-id, x-username, x-role'
  );
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};
