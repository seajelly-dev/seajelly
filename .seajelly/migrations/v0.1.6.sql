ALTER TABLE public.channels
  DROP CONSTRAINT IF EXISTS channels_platform_check;

ALTER TABLE public.channels
  ADD CONSTRAINT channels_platform_check
  CHECK (platform IN ('telegram','wecom','feishu','slack','qqbot','whatsapp','dingtalk','discord','web','weixin'));

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_source_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_source_check
  CHECK (source IN ('telegram','wecom','feishu','slack','qqbot','whatsapp','weixin','dingtalk','discord','cron','webhook','manual'));
