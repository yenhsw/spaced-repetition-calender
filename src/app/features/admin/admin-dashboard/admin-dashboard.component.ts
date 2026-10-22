import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { UserProfile } from '../../../core/models/profile.model';
import { UserAdminStats } from '../../../core/models/topic-progress.model';
import { UserRole } from '../../../core/enums/user-role.enum';

interface ProfileWithStats extends UserProfile {
  stats?: UserAdminStats;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.scss',
})
export class AdminDashboardComponent implements OnInit {
  private readonly adminService = inject(AdminService);

  protected readonly profiles = signal<ProfileWithStats[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly searchKeyword = signal('');
  protected readonly UserRole = UserRole;

  ngOnInit(): void {
    void this.loadProfiles();
  }

  async loadProfiles(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const keyword = this.searchKeyword().trim();
      const data = keyword
        ? await this.adminService.searchUsers(keyword)
        : await this.adminService.listUsers();

      const statsMap = await this.adminService.getStatsForUsers(data.map((p) => p.id));

      const withStats: ProfileWithStats[] = data.map((profile) => ({
        ...profile,
        stats: statsMap.get(profile.id),
      }));

      this.profiles.set(withStats);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Không tải được danh sách user');
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(): void {
    void this.loadProfiles();
  }
}
