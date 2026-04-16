import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AsyncPipe } from '@angular/common';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AsyncPipe],
  template: `
    <nav class="navbar">
      <div class="nav-brand">
        <a routerLink="/">MyEcom</a>
      </div>
      <div class="nav-links">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Home</a>
        @if (isAuthenticated$ | async) {
          <a routerLink="/dashboard" routerLinkActive="active">Dashboard</a>
          <a routerLink="/profile" routerLinkActive="active">Profile</a>
          <a routerLink="/products" routerLinkActive="active">Products</a>
          @if (isAdmin$ | async) {
            <a routerLink="/admin-panel" routerLinkActive="active" class="admin-link">Admin Panel</a>
            <a routerLink="/user-management" routerLinkActive="active" class="admin-link">Users</a>
            <a routerLink="/settings" routerLinkActive="active" class="admin-link">Settings</a>
          }
          <button (click)="logout()" class="btn btn-logout">Logout</button>
        } @else {
          <button (click)="login()" class="btn btn-login">Login</button>
        }
      </div>
    </nav>
    <main>
      <router-outlet />
    </main>
  `,
})
export class App {
  private authService = inject(AuthService);

  isAuthenticated$ = this.authService.isAuthenticated$;
  isAdmin$ = this.authService.hasRole$('admin');

  login() {
    this.authService.login();
  }

  logout() {
    this.authService.logout();
  }
}
