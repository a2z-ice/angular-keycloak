import { PassedInitialConfig } from 'angular-auth-oidc-client';

export const authConfig: PassedInitialConfig = {
  config: {
    authority: 'https://idp.keycloak.net:8443/realms/myecom',
    redirectUrl: 'https://myecom.net:5500',
    postLogoutRedirectUri: 'https://myecom.net:5500',
    clientId: 'myecom-spa',
    scope: 'openid profile email',
    responseType: 'code',
    silentRenew: true,
    useRefreshToken: true,
    secureRoutes: ['https://myecom.net:5500/api'],
  },
};
