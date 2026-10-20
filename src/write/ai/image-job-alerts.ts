import { t } from '../../utils/ui-text';
import { toast } from '../editor/dom';
import { describeImageError } from './image-errors';
import { activeImageJobCount, onImageJobEnd, restoreImageJobs } from './image-jobs';

// Page-wide: tell the writer when a picture made in the background is ready or failed, and warn before leaving while one is still being made.
export function startImageJobAlerts(openGallery: () => void): void {
	void restoreImageJobs();
	onImageJobEnd(job => {
		if (job.state === 'ready') toast(t('配图已生成，已放进图库'), 'info', { label: t('打开图库'), run: openGallery });
		else toast(t('配图没有生成：{0}', [describeImageError(job.error)]), 'error', { label: t('打开图库'), run: openGallery });
	});
	window.addEventListener('beforeunload', event => { if (activeImageJobCount() > 0) { event.preventDefault(); event.returnValue = ''; } });
}
