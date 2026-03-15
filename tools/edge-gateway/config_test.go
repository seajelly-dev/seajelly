package main

import "testing"

func TestConfigValidateRejectsDuplicateCapabilitiesAndPaths(t *testing.T) {
	t.Parallel()

	config := &Config{
		Version: configVersionV1,
		Routes: []RouteConfig{
			{
				ID:           "route-a",
				Capability:   "platform.wecom.http",
				Kind:         routeKindHTTPForward,
				Path:         "/routes/wecom/http",
				AllowedHosts: []string{"qyapi.weixin.qq.com"},
			},
			{
				ID:           "route-b",
				Capability:   "platform.wecom.http",
				Kind:         routeKindHTTPForward,
				Path:         "/routes/wecom/http-2",
				AllowedHosts: []string{"qyapi.weixin.qq.com"},
			},
		},
	}

	if err := config.Validate(); err == nil {
		t.Fatal("expected duplicate capability validation error")
	}
}

func TestConfigValidateRejectsDuplicatePaths(t *testing.T) {
	t.Parallel()

	config := &Config{
		Version: configVersionV1,
		Routes: []RouteConfig{
			{
				ID:           "route-a",
				Capability:   "platform.wecom.http",
				Kind:         routeKindHTTPForward,
				Path:         "/routes/wecom/http",
				AllowedHosts: []string{"qyapi.weixin.qq.com"},
			},
			{
				ID:           "route-b",
				Capability:   "platform.wecom.media-upload",
				Kind:         routeKindUpload,
				Path:         "/routes/wecom/http",
				AllowedHosts: []string{"qyapi.weixin.qq.com"},
			},
		},
	}

	if err := config.Validate(); err == nil {
		t.Fatal("expected duplicate path validation error")
	}
}
