// Singleton shared between auth/login and auth/status routes in the same Node.js process
export const loginState = {
  browser: null,
  context: null,
  page: null,
  polling: null, // setInterval handle
};
