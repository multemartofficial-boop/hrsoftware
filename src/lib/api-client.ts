// Same-origin in production (Vercel serves /api via serverless functions);
// the Vite dev server targets the local Express server unless VITE_API_URL is set.
const API_BASE_URL =
  import.meta.env['VITE_API_URL'] || (import.meta.env.DEV ? 'http://localhost:3001' : '');

class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private loadToken() {
    // Load token from localStorage (only if running in browser)
    if (typeof window !== 'undefined' && window.localStorage) {
      this.token = localStorage.getItem('auth_token');
    }
  }

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem('auth_token', token);
    }
  }

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem('auth_token');
    }
  }

  // The stored JWT is dead (expired or server secret rotated) — wipe the session
  // and bounce back to the login screen instead of letting every request 401 in
  // the background. /api/auth/* is excluded: 401s there are bad credentials in
  // login/reset flows (no session yet), and must not force a reload.
  private handleUnauthorized(endpoint: string) {
    if (typeof window === 'undefined' || endpoint.startsWith('/api/auth/')) return;
    if (!window.localStorage.getItem('workhr.session')) return; // already logged out
    this.clearToken();
    window.localStorage.removeItem('workhr.session');
    if (window.location.pathname !== '/') window.location.assign('/');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Ensure token is loaded from localStorage before each request
    if (typeof window !== 'undefined') {
      this.loadToken();
    }

    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    }).catch(err => {
      console.error('[API Client] Fetch failed:', {
        message: err.message,
        name: err.name,
        url,
        isBrowser: typeof window !== 'undefined'
      });
      throw new Error(`Failed to fetch: ${err.message}`);
    });

    if (!response.ok) {
      if (response.status === 401) this.handleUnauthorized(endpoint);
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      console.error('API Error:', response.status, response.statusText, error);
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async patch<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  // File upload method
  async uploadFile<T>(endpoint: string, formData: FormData): Promise<T> {
    // Ensure token is loaded from localStorage before each request
    this.loadToken();

    const url = `${this.baseUrl}/api${endpoint}`;

    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      if (response.status === 401) this.handleUnauthorized(endpoint);
      const errorText = await response.text().catch(() => '');
      let error: { error?: string } = { error: 'Upload failed' };
      try { error = JSON.parse(errorText); } catch { /* not JSON */ }
      throw new Error(error.error || `Upload failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Fetch a binary document with auth (used for secure admin document viewing)
  async getBlob(endpoint: string): Promise<Blob> {
    this.loadToken();
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
      if (response.status === 401) this.handleUnauthorized(endpoint);
      throw new Error(`Failed to load document: ${response.status} ${response.statusText}`);
    }
    return response.blob();
  }
}

// Direct export to avoid Proxy issues
export const apiClient = new ApiClient(API_BASE_URL);
