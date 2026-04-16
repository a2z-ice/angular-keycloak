import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [AsyncPipe],
  template: `
    <div class="page">
      <h1>Welcome to MyEcom</h1>
      <p>Your one-stop e-commerce platform.</p>
      @if (!(isAuthenticated$ | async)) {
        <button (click)="login()" class="btn btn-primary">Login</button>
      } @else {
        <p>You are logged in. Navigate using the menu above.</p>
      }
    </div>
  `,
})
export class HomeComponent {
  private authService = inject(AuthService);
  isAuthenticated$ = this.authService.isAuthenticated$;

  login() {
    this.authService.login();
  }
}
