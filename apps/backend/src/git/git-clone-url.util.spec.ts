import { buildGitCloneUrl } from './git-clone-url.util';

describe('buildGitCloneUrl', () => {
  it('возвращает null без GIT_CLONE_BASE_URL', () => {
    expect(buildGitCloneUrl('/var/git/app-nervion.git', '')).toBeNull();
    expect(buildGitCloneUrl('/var/git/app-nervion.git', undefined)).toBeNull();
  });

  it('собирает HTTPS URL из basename gitdir', () => {
    expect(buildGitCloneUrl('/var/git/app-nervion.git', 'https://git.example.com')).toBe(
      'https://git.example.com/app-nervion.git',
    );
  });

  it('собирает SSH URL и убирает лишние слэши у base', () => {
    expect(buildGitCloneUrl('/var/git/crm.git', 'git@server:/var/git/')).toBe('git@server:/var/git/crm.git');
  });

  it('добавляет .git к каталогу без суффикса', () => {
    expect(buildGitCloneUrl('/var/git/my-repo', 'https://git.example.com/repos')).toBe(
      'https://git.example.com/repos/my-repo.git',
    );
  });
});
