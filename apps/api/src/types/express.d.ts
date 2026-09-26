declare global {
  namespace Express {
    interface Request {
      /** Present on every request; echoed in responses and passed to the model service. */
      requestId: string;
      user?: {
        id: string;
        email: string;
        emailVerified: boolean;
        role: 'user' | 'researcher' | 'admin';
        preferences: {
          theme: 'light' | 'dark';
          language: 'en' | 'fil';
        };
        createdAt: string;
      };
    }
  }
}

export {};
