import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { StudyCalendarComponent } from '../../calendar/study-calendar/study-calendar.component';
import { ProfileService } from '../../../core/services/profile.service';

@Component({
  selector: 'app-user-calendar',
  standalone: true,
  imports: [StudyCalendarComponent, RouterLink],
  templateUrl: './user-calendar.component.html',
  styleUrl: './user-calendar.component.scss',
})
export class UserCalendarComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly profileService = inject(ProfileService);

  protected readonly userId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('userId') ?? '')),
    { initialValue: '' },
  );

  protected profileName = '';

  async ngOnInit(): Promise<void> {
    const id = this.userId();
    if (!id) return;

    const profile = await this.profileService.fetchProfile(id);
    this.profileName = profile?.display_name ?? profile?.email ?? id;
  }
}
