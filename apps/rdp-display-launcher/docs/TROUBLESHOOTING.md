# 문제 해결

## 로그인 창이 나오지 않거나 저장된 자격증명이 반복 사용됨

노트북 PowerShell 또는 명령 프롬프트에서 기존 자격증명을 지우고 강제로 다시 묻도록 실행합니다.

```powershell
cmdkey /delete:TERMSRV/<TAILSCALE_IP_OR_MAGICDNS>
mstsc.exe /v:<TAILSCALE_IP_OR_MAGICDNS> /multimon /prompt
```

사용자 이름은 `컴퓨터이름\기존사용자이름`, 비밀번호는 PIN이 아닌 Windows 계정 비밀번호를 입력합니다.

## “자격 증명이 작동하지 않습니다”

1. 호스트에서 `whoami`로 실제 계정 이름을 확인합니다.
2. 이메일 대신 `컴퓨터이름\사용자이름`을 입력합니다.
3. PIN 대신 실제 비밀번호를 입력합니다.
4. Microsoft 계정 비밀번호가 계속 거절되면 별도 프로필을 만들지 말고 기존 계정을 로컬 계정으로 전환합니다.
5. NLA를 끄거나 빈 비밀번호를 쓰는 방식으로 우회하지 않습니다.

## “서버에 대한 원격 액세스를 사용할 수 없음”

호스트 관리자 PowerShell에서 확인합니다.

```powershell
Get-Service TermService, Tailscale
Get-NetTCPConnection -LocalPort 3389 -State Listen
Get-NetFirewallRule -Name RemoteDesktop-UserMode-In-TCP,RemoteDesktop-UserMode-In-UDP |
  Select-Object Name,Enabled,Profile
tailscale status
tailscale ip -4
```

노트북에서는 다음을 확인합니다.

```powershell
tailscale status
tailscale ping <HOST_DEVICE_OR_IP>
Test-NetConnection <TAILSCALE_IP_OR_MAGICDNS> -Port 3389
```

양쪽 장치가 같은 Tailnet에 있고 호스트가 절전 상태가 아닌지 확인합니다.

## Tailscale이 다른 Windows 사용자 세션에서 사용 중이라고 표시됨

같은 PC의 다른 Windows 세션에 Tailscale UI가 남아 있을 수 있습니다. 사용하지 않는 세션을 **로그오프**하고 호스트 관리자 PowerShell에서 서비스를 다시 시작합니다.

```powershell
quser
Restart-Service Tailscale
```

활성 작업이 있는 다른 사용자 세션을 임의로 로그오프하지 않습니다.

## 실제 모니터 복제 화면만 보임

정상 RDP는 Shadow/화면 공유가 아닙니다. `mstsc.exe /multimon` 또는 이 폴더의 실행기를 사용합니다. 원격 지원, Quick Assist, Apollo/Artemis 화면 공유, RDP Shadow는 실제 세션 화면을 제어하는 다른 방식입니다.

## 듀얼 모니터가 활성화되지 않음

노트북에서 확인합니다.

```powershell
mstsc.exe /l
```

- Windows 디스플레이 설정의 화면 번호가 아니라 이 명령에 표시된 RDP 모니터 ID를 사용합니다.
- 실행기에 지정한 ID 중 하나가 틀리면 RDP가 유효한 메인 모니터 한 대만 사용할 수 있습니다.
- 두 모니터가 확장 모드인지 확인합니다.
- 두 모니터의 위쪽 또는 아래쪽 가장자리가 Windows 디스플레이 배치에서 맞닿아 있도록 조정합니다.
- 전체 화면으로 연결합니다.
- 특정 두 대만 쓸 때 `.rdp` 파일의 `selectedmonitors`에 실제 ID를 넣습니다.
